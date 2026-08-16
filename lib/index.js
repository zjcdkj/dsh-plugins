/**
 * dsh-plugin-qwen-image — a `qwen_image` tool that lets a text-only coding
 * model read images.
 *
 * The design point: the image never enters the CALLING model's context. The
 * tool sends it to a separately configured vision route through `ctx.llm` and
 * returns plain TEXT, so DeepSeek (or any text-only route) keeps driving the
 * session while Qwen-VL does the looking. That is the whole reason this exists
 * instead of the built-in `read_image`, which puts the image into the session's
 * own route and therefore refuses unless that route accepts images.
 *
 * Everything it touches is a public seam — `ctx.tools`, `ctx.llm`, `ctx.fs`,
 * `ctx.attachments` — so the plugin installs into a profile and needs no change
 * to the harness itself.
 */

import { realpathSync } from 'node:fs'
import { basename, extname } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

/** Cordis plugin name; also the id this plugin's patch row uses. */
export const name = 'qwen-image'

/**
 * Required services. `attachments` is required rather than optional because an
 * `ImageBlock` carries a durable attachment reference: without a store there is
 * no way to put an image into a request at all.
 */
export const inject = ['tools', 'llm', 'fs', 'attachments']

/** Extensions accepted here; the attachment service's magic-byte check stays authoritative. */
const MEDIA_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const DEFAULT_QUESTION = '用中文描述这张图片的内容。如果图中有文字，请一并逐字转录。'

/** Matches a `..` path segment, the case that makes a symlinked cwd's identity observable. */
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * Resolution options for this call, anchoring a relative path to the CALLING
 * SESSION's workspace rather than the server's launch directory. Without the
 * `cwd`, `resolve` falls back to the provider default — which is the dsh
 * process cwd, so `slide_05.png` read from wherever the server happened to be
 * started. This mirrors what the in-box filesystem tools do.
 * @param {import('@deepseek-ai/dsh-tools').ToolExecution} exec - the current execution; only `agent` and `signal` are read.
 * @param {string} requestedPath - the path the provider will resolve.
 * @returns {{ cwd?: string, signal?: AbortSignal }} provider resolution options.
 */
function sessionResolveOptions(exec, requestedPath) {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined) return { signal: exec.signal }
  // Parent traversal can leave the workspace through a symlinked cwd, so
  // canonicalize before the provider joins the two.
  if (!PARENT_PATH_SEGMENT.test(cwd) && !PARENT_PATH_SEGMENT.test(requestedPath)) {
    return { cwd, signal: exec.signal }
  }
  let canonical = cwd
  try {
    canonical = realpathSync(cwd)
  } catch {
    // A cwd that cannot be canonicalized (removed, permission) stays as given;
    // the provider reports the real failure with better context than we can.
  }
  return { cwd: canonical, signal: exec.signal }
}

export const Config = Schema.object({
  provider: Schema.string()
    .default('dashscope')
    .description('视觉路由的 provider id（`llm-pi-ai` settings 段里的键名）。'),
  model: Schema.string()
    .default('qwen3-vl-plus')
    .description('视觉模型 id。该模型必须在配置里声明 `input: [text, image]`。'),
  systemPrompt: Schema.string()
    .default('你是图像理解助手。只描述你确实看到的内容，不要推测。回答简洁、可直接被程序消费。')
    .description('发给视觉模型的 system 提示。'),
  maxOutputTokens: Schema.number()
    .default(1024)
    .description('视觉模型单次回答的输出上限。'),
  timeoutMs: Schema.number()
    .default(120000)
    .description('单次工具调用的协作式超时预算（毫秒）。'),
})

/**
 * Aggregate a chunk stream into plain text, failing loudly on a terminal error.
 * @param {AsyncIterable<unknown>} stream - the `ctx.llm.stream` chunk stream.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @returns {Promise<string>} the concatenated text blocks.
 */
async function collectText(stream, signal) {
  const assembler = new BlockAssembler()
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    assembler.push(chunk)
  }
  signal?.throwIfAborted()
  const finish = assembler.finish
  if (finish != null && finish.kind === 'error') {
    throw new Error(`qwen_image: the vision route failed: ${finish.message ?? finish.kind}`)
  }
  return assembler.blocks()
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
}

/**
 * Register the tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {ReturnType<typeof Config>} config - resolved configuration.
 */
export function apply(ctx, config) {
  ctx.tools.register(defineTool({
    name: 'qwen_image',
    description:
      'Look at a local image file and return a text answer about it. Use this whenever you need to read a screenshot, chart, scan, or photo: the image is sent to a separate vision model, so it works even though your own model cannot accept images. Supports PNG/JPEG/WebP/GIF.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Absolute path to the image file. A relative path resolves against the session workspace.',
      },
      question: {
        type: 'string',
        description: 'What to ask about the image (e.g. "transcribe all text", "what does this chart show"). Omit for a general description.',
      },
    },
    output: {
      schema: {
        type: 'object',
        // The compiler requires this explicitly rather than defaulting it.
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true, description: 'The resolved workspace-relative image path.' },
          model: { type: 'string', required: true, description: 'The vision model that produced the answer.' },
          description: { type: 'string', required: true, description: 'The vision model’s answer about the image.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `<image path="${value.path}" model="${value.model}">\n${value.description}\n</image>`,
      }],
    },
    timeoutMs: config.timeoutMs,
    // Each call is an independent read plus one stateless model request.
    isConcurrencySafe: () => true,
    // Declaring the file as a read location is what lets a resource/deliverable
    // surface account for it without knowing this tool's name.
    presentCall: args => ({
      card: 'generic',
      title: `Look at ${basename(String(args.file_path ?? ''))}`,
      kind: 'read',
      locations: [{ path: String(args.file_path ?? '') }],
    }),
    async execute(args, exec) {
      const requested = String(args.file_path ?? '').trim()
      if (requested === '') throw new Error('qwen_image: file_path must be a non-empty string')

      const mediaType = MEDIA_TYPES[extname(requested).toLowerCase()]
      if (mediaType === undefined) {
        throw new Error(`qwen_image: cannot read "${requested}": only PNG/JPEG/WebP/GIF paths are accepted`)
      }

      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error(`qwen_image: cannot read "${requested}": no attachment service is mounted`)
      }
      if (!attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`qwen_image: ${mediaType} images are not accepted by this deployment`)
      }

      // Gate on the CONFIGURED route, not the session's: the point of this tool
      // is that the calling model need not accept images. Checking before any
      // I/O keeps a misconfiguration from writing an attachment first.
      const route = await ctx.llm.resolveModelInfo(config.provider, config.model, exec.signal)
      if (route.inputModalities === undefined || !route.inputModalities.includes('image')) {
        throw new Error(
          `qwen_image: route "${config.provider}/${config.model}" does not declare image input. `
          + `Add \`input: [text, image]\` to that model in the llm-pi-ai settings section, `
          + `or point this plugin at a vision route with \`config.provider\`/\`config.model\`.`,
        )
      }

      const target = await ctx.fs.resolve(requested, sessionResolveOptions(exec, requested))
      const byteCap = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
      const data = await ctx.fs.readBytes(target, exec.signal, byteCap)
      // Commit before requesting: an ImageBlock must reference durable bytes.
      const attachment = await attachments.saveImage({
        data,
        mediaType,
        name: basename(target.displayPath),
      })

      const question = String(args.question ?? '').trim()
      const messages = [createUserMessage({
        content: [
          { type: 'image', attachment },
          { type: 'text', text: question === '' ? DEFAULT_QUESTION : question },
        ],
        source: { kind: 'plugin', plugin: 'qwen-image' },
      })]

      const description = await collectText(ctx.llm.stream({
        provider: config.provider,
        model: config.model,
        messages,
        system: config.systemPrompt,
        maxTokens: config.maxOutputTokens,
        signal: exec.signal,
      }), exec.signal)

      if (description === '') {
        throw new Error(`qwen_image: "${config.model}" returned no text for "${target.displayPath}"`)
      }
      return { path: target.displayPath, model: config.model, description }
    },
  }))
}
