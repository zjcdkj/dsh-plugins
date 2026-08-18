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
 * The second half of the same idea is PASTING. Dropping or pasting an image into
 * the composer normally fails on such a deployment, and it fails late: the app
 * accepts the image, and the Host then refuses the whole request because the
 * session's model does not declare image input. So the browser half stops that
 * paste before the app sees it and hands the bytes here, this half saves them
 * inside the session workspace, and a runtime-context snapshot tells the model
 * an image is waiting and how to read it. The conversation still carries no
 * image part, which is exactly why the request goes through.
 *
 * Everything it touches is a public seam — `ctx.tools`, `ctx.llm`, `ctx.fs`,
 * `ctx.attachments`, `ctx.systemPrompt`, `ctx.connection.rpc` — so the plugin
 * installs into a profile and needs no change to the harness itself. The last
 * three are optional children: a CLI-only or headless composition gets the tool
 * without the paste path, because there is no browser to paste from.
 */

import { realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

/** Cordis plugin name; also the id this plugin's patch row uses. */
export const name = 'qwen-image'

/**
 * The channel the browser half stashes pasted images on.
 *
 * One segment, matching the pattern both halves enforce; it carries the package
 * name because a duplicate prefix route fails the boot rather than shadowing.
 *
 * A channel of this plugin's own is the only seam available. The app's composer
 * hands a pasted image to its own image rail, and the Host then REFUSES the
 * request when the session's model does not declare image input — which is
 * exactly the deployment this plugin exists for. The one reserved alternative,
 * `intercept('/api', …)`, is a single global seat already held by the API
 * gateway. So the browser half stops the paste before the app sees it and sends
 * the bytes here instead.
 */
export const CHANNEL = '/dsh-qwen-image'

/**
 * Where a pasted image lands, relative to the session workspace.
 *
 * Inside the workspace rather than a temp directory, for three reasons: the
 * model receives a path it can hand to any other tool, `ctx.fs` will read it
 * without a sandbox exception, and the user can see and delete what accumulated.
 * The leading dot keeps it out of the way of the files they came to work on.
 */
const STASH_DIR = '.dsh-pasted'

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

/**
 * The extension written for each accepted media type.
 *
 * Inverted from {@link MEDIA_TYPES} rather than written out again, so the set of
 * types this plugin stashes cannot drift from the set it reads. Two extensions
 * share `image/jpeg`; reversing before the fold lets the FIRST spelling declared
 * above be the last one assigned, so `.jpg` wins over `.jpeg`.
 */
const EXTENSIONS = Object.fromEntries(
  Object.entries(MEDIA_TYPES).reverse().map(([extension, mediaType]) => [mediaType, extension]),
)

const DEFAULT_QUESTION = '用中文描述这张图片的内容。如果图中有文字，请一并逐字转录。'

/** Matches a `..` path segment, the case that makes a symlinked cwd's identity observable. */
const PARENT_PATH_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/**
 * `LlmError.code` the llm service raises when a provider route has no adapter
 * registered. Matched by code rather than by importing the error class: the
 * code is the stable taxonomy the seam documents, and duck-typing keeps this
 * package from depending on where that class currently lives.
 */
const NO_ADAPTER = 'NO_ADAPTER'

/** The YAML a deployment with no vision route has to add, quoted in the failure. */
const SETTINGS_EXAMPLE = `  llm-pi-ai:
    providers:
      dashscope:
        apiKeyEnv: DASHSCOPE_API_KEY
        api: openai-completions
        baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
        models:
          - id: qwen3-vl-plus
            input: [text, image]`

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
    .description('首选视觉路由的 provider id（`llm-pi-ai` settings 段里的键名）。该路由不可用时会自动改用任意已声明 `input: [text, image]` 的模型。'),
  model: Schema.string()
    .default('qwen3-vl-plus')
    .description('首选视觉模型 id。该模型需声明 `input: [text, image]`；未声明或不存在时回退到自动发现。'),
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
 * Whether a model entry declares image input.
 *
 * The seam documents `inputModalities` as absent meaning UNKNOWN while an
 * explicit omission is negative capability — so only a declared `image`
 * counts. Treating "unknown" as capable would send the bytes to a route that
 * cannot take them and surface as a provider 400 instead of a config problem.
 * @param {{ inputModalities?: readonly string[] }} info - resolved or listed model metadata.
 * @returns {boolean} true when the model states it accepts images.
 */
function acceptsImage(info) {
  return info.inputModalities !== undefined && info.inputModalities.includes('image')
}

/**
 * Scan every registered provider for models that declare image input.
 *
 * This is what makes the plugin work without configuration: a deployment that
 * already reached a vision model for any other reason needs no settings edit
 * here. First registered wins, so the order is the deployment's own.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @returns {Promise<{ route?: { provider: string, model: string }, scanned: string[] }>}
 *   the first usable route when one exists, and the provider ids visited.
 */
async function discoverVisionRoute(ctx, signal) {
  const scanned = []
  for (const provider of ctx.llm.listProviders()) {
    signal?.throwIfAborted()
    scanned.push(provider.id)
    let models
    try {
      models = await ctx.llm.listModels(provider.id)
    } catch {
      // One provider whose listing fails — expired credential, unreachable
      // gateway, adapter bug — must not take the whole scan down with it.
      continue
    }
    const found = models.find(acceptsImage)
    // Stop at the first hit. Listing a provider is a network call on a gateway
    // adapter, so enumerating the rest would buy nothing but a longer log line.
    // The failure branch still sees every provider: reaching it means no
    // provider had a hit, so the loop ran to completion.
    if (found !== undefined) return { route: { provider: provider.id, model: found.id }, scanned }
  }
  return { scanned }
}

/**
 * Pick the vision route for this deployment: the configured one when it accepts
 * images, otherwise the first discovered one.
 *
 * Both misses are treated the same way on purpose. A provider that is not
 * registered raises `NO_ADAPTER`, and a registered provider whose model never
 * declared `input: [text, image]` resolves without modalities — from the user's
 * side those are one situation ("the route I named is not usable"), and the
 * remedy is the same.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ provider: string, model: string }} config - the preferred route.
 * @param {AbortSignal | undefined} signal - caller cancellation.
 * @returns {Promise<{ provider: string, model: string }>} a route that declares image input.
 */
async function resolveVisionRoute(ctx, config, signal) {
  let configuredProblem
  try {
    const info = await ctx.llm.resolveModelInfo(config.provider, config.model, signal)
    if (acceptsImage(info)) return { provider: config.provider, model: config.model }
    configuredProblem = 'does not declare image input'
  } catch (error) {
    // Any other failure is the llm service reporting something real (aborted,
    // invalid metadata) and belongs to the caller, not to this fallback.
    if (error?.code !== NO_ADAPTER) throw error
    configuredProblem = 'is not a registered provider route'
  }

  const found = await discoverVisionRoute(ctx, signal)
  if (found.route !== undefined) {
    ctx.logger.info(
      `qwen-image: the configured route "${config.provider}/${config.model}" ${configuredProblem}; `
      + `using "${found.route.provider}/${found.route.model}" instead`,
    )
    return found.route
  }

  throw new Error(
    `qwen_image: no vision route is available.\n`
    + `The configured route "${config.provider}/${config.model}" ${configuredProblem}, `
    + `and no model on any registered provider declares image input.\n`
    + `Providers scanned: ${found.scanned.length === 0 ? '(none registered)' : found.scanned.join(', ')}\n`
    + `Declare a vision model in the llm-pi-ai section of settings.yaml:\n\n${SETTINGS_EXAMPLE}\n\n`
    + `\`input: [text, image]\` is the line that makes the model usable here — a model that omits it `
    + `is reported as not accepting images. Put the key in .credentials.yaml as DASHSCOPE_API_KEY, `
    + `or point this plugin at an existing vision route with config.provider / config.model.`,
  )
}

/** Most pasted images held per session; the oldest is dropped past this. */
const MAX_PER_SESSION = 8

/** Most sessions tracked at once, so a long-lived Host cannot grow without bound. */
const MAX_SESSIONS = 64

/**
 * A filename for one stashed paste.
 *
 * Generated here rather than taken from the browser, and that is the whole
 * containment story for this channel: the caller supplies bytes and a media
 * type, never a path or a name, so there is no traversal to defend against. The
 * name the user's clipboard carried is kept for DISPLAY only.
 * @param {string} mediaType - one of {@link MEDIA_TYPES}' values.
 * @returns {string} a sortable, collision-resistant basename with extension.
 */
function stashFileName(mediaType) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace('.', '-').replace('Z', '')
  const salt = Math.random().toString(36).slice(2, 6)
  return `paste-${stamp}-${salt}${EXTENSIONS[mediaType]}`
}

/** Human byte size for the model-facing listing and the panel's tooltip. */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Pasted images per session, awaiting a read.
 *
 * Kept in memory rather than in the session log because it is a HANDOFF, not a
 * transcript fact: the bytes are already durable on disk, and what this holds is
 * the short-lived knowledge that the user just supplied them and nobody has
 * looked yet. Losing it to a Host restart costs a re-paste, which is the right
 * price for not writing to a log this plugin does not own.
 */
class PasteStash {
  constructor() {
    /**
     * Newest last, per session.
     * @type {Map<string, Array<{ rel: string, abs: string, name: string, bytes: number }>>}
     */
    this.bySession = new Map()
  }

  /**
   * @param {string | undefined} sessionId - the asking session.
   * @returns {ReadonlyArray<object>} its waiting entries, newest last.
   */
  list(sessionId) {
    if (sessionId === undefined) return []
    return this.bySession.get(sessionId) ?? []
  }

  /**
   * Record one stashed image, evicting what no longer fits.
   * @param {string} sessionId - the session that pasted it.
   * @param {object} entry - the stashed image's paths, display name and size.
   * @returns {Promise<void>} after any eviction's file is removed.
   */
  async add(sessionId, entry) {
    // Evict whole sessions before touching this one's list, so a busy Host
    // forgets OTHER conversations rather than the paste being added right now.
    if (!this.bySession.has(sessionId) && this.bySession.size >= MAX_SESSIONS) {
      const oldest = this.bySession.keys().next()
      if (!oldest.done) this.bySession.delete(oldest.value)
    }
    const entries = this.bySession.get(sessionId) ?? []
    entries.push(entry)
    while (entries.length > MAX_PER_SESSION) {
      const evicted = entries.shift()
      // The bytes were written by this plugin into its own directory, so
      // removing them is safe; a failure is not worth reporting to the paster.
      await rm(evicted.abs, { force: true }).catch(() => { })
    }
    this.bySession.set(sessionId, entries)
  }

  /**
   * Forget one entry, optionally deleting the file with it.
   * @param {string | undefined} sessionId - the owning session.
   * @param {object | undefined} entry - the entry to forget.
   * @param {boolean} unlink - whether the bytes go too (a user dismissal) or
   *   stay on disk (a read, where the path remains useful).
   * @returns {Promise<void>} after any deletion.
   */
  async forget(sessionId, entry, unlink) {
    if (sessionId === undefined || entry === undefined) return
    const entries = this.bySession.get(sessionId)
    if (entries === undefined) return
    const at = entries.indexOf(entry)
    if (at >= 0) entries.splice(at, 1)
    if (entries.length === 0) this.bySession.delete(sessionId)
    if (unlink) await rm(entry.abs, { force: true }).catch(() => { })
  }

  /**
   * Find the entry a path refers to, by either spelling it may arrive as.
   * @param {string | undefined} sessionId - the owning session.
   * @param {string} path - a workspace-relative or absolute path.
   * @returns {object | undefined} the matching entry, when there is one.
   */
  find(sessionId, path) {
    const normalized = path.replaceAll('\\', '/')
    return this.list(sessionId).find(entry =>
      entry.rel === normalized || entry.abs.replaceAll('\\', '/') === normalized)
  }
}

/**
 * The model-facing account of what is waiting.
 *
 * This is the piece that makes pasting WORK rather than merely be recorded. The
 * bytes deliberately never enter the conversation — that is what keeps a
 * text-only route from refusing the request — so without this the model has no
 * way to know an image arrived at all, and would answer "you did not send me
 * anything" to a user who plainly did.
 *
 * Written as runtime context rather than a prompt section because that is what
 * it is: a fact about right now, which the harness re-states each assembly and
 * supersedes with the next snapshot. When the list empties, the text empties and
 * the snapshot stops mentioning images.
 * @param {ReadonlyArray<object>} entries - the session's waiting images.
 * @returns {string} the snapshot text, or `''` when nothing waits.
 */
function describePending(entries) {
  if (entries.length === 0) return ''
  const rows = entries.map((entry, index) =>
    `${index + 1}. ${entry.rel} — ${entry.name} (${formatBytes(entry.bytes)})`).join('\n')
  const which = entries.length === 1 ? 'it' : 'the most recent one'
  return `The user pasted ${entries.length === 1 ? 'an image' : `${entries.length} images`} into the composer. `
    + `The bytes are NOT in the conversation content — they were saved into this session's workspace, `
    + `because your own model route may not accept images.\n\n${rows}\n\n`
    + `To see ${which}, call \`qwen_image\` with no \`file_path\`. To pick a specific one, pass its path above. `
    + `A pasted image stays listed here until it has been read, so treat this list as "waiting for you to look".`
}

/**
 * The app's error vocabulary is a closed set and `details` is required per code.
 * An invented code fails the browser's response parse and surfaces as a
 * transport error instead of the message written here.
 */
const badRequest = message => ({ ok: false, error: { code: 'bad-request', message, details: { issues: [] } } })
const unwritable = (message, path) => ({ ok: false, error: { code: 'directory-unreadable', message, details: { path } } })

/** Byte cap for a paste when no attachment service states one. */
const FALLBACK_BYTE_CAP = 10 * 1024 * 1024

/** Longest display name kept from the clipboard, which supplies it. */
const MAX_DISPLAY_NAME = 120

/**
 * Sanitize the clipboard's own filename down to something safe to DISPLAY.
 *
 * It never becomes part of a path — {@link stashFileName} owns that — so this
 * only has to keep a hostile or malformed name from reaching a UI: separators
 * out so it cannot read as a path, control characters out, and a length bound.
 * @param {unknown} value - the `name` the browser reported, if any.
 * @param {string} fallback - the generated name to use when nothing usable came.
 * @returns {string} a display name.
 */
function displayName(value, fallback) {
  if (typeof value !== 'string') return fallback
  /* eslint-disable-next-line no-control-regex -- stripping controls is the point */
  const cleaned = value.replaceAll(/[\u0000-\u001F\u007F/\\]/g, '').trim()
  return cleaned === '' ? fallback : cleaned.slice(0, MAX_DISPLAY_NAME)
}

/**
 * Serve the stash channel: the browser half's only way to hand over bytes.
 *
 * Fenced two ways, the same pair `session-resources` uses. `authority:
 * 'loopback'` means only a page on this machine can call it at all. Inside that,
 * the caller never names a file: it sends bytes plus a media type, and every
 * path is composed here from the session's own workspace root and a generated
 * basename. There is no input a `..` could ride in on.
 * @param {import('@deepseek-ai/cordis').Context} ctx - context with `connection` and `sessions`.
 * @param {PasteStash} stash - the per-session waiting list to record into.
 */
function installStashChannel(ctx, stash) {
  /**
   * The byte cap this deployment enforces, read at call time.
   *
   * The attachment service's own limits are used rather than a number of this
   * plugin's own, so a paste that is accepted here is one the vision request can
   * actually carry later.
   * @returns {number} the smallest applicable cap.
   */
  function byteCap() {
    const attachments = ctx.get('attachments')
    if (attachments === undefined) return FALLBACK_BYTE_CAP
    return Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  }

  /**
   * Where this session's workspace is.
   *
   * The Host's own record wins; a session reopened from history is cold, and
   * `sessions.get` answers for attached sessions only, so the caller's value
   * stands in. That concession is bounded by the fence above — the channel is
   * loopback-only and the caller is the app, which received this very path from
   * this very Host — and nothing here trusts it for anything but the root.
   * @param {object} payload - the request payload.
   * @param {string} sessionId - the asking session.
   * @returns {string | undefined} the root, when one is known.
   */
  function workspaceRoot(payload, sessionId) {
    const live = ctx.sessions.get(sessionId)?.header?.cwd
    if (typeof live === 'string' && live !== '') return live
    const claimed = payload?.cwd
    return typeof claimed === 'string' && claimed !== '' ? claimed : undefined
  }

  /**
   * Accept one pasted image.
   * @param {object} payload - `{ sessionId, cwd, mediaType, data, name }`.
   * @param {AbortSignal} signal - carries the caller's departure.
   * @returns {Promise<object>} an RpcResult with the stashed entry.
   */
  async function stashImage(payload, signal) {
    const sessionId = payload?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') {
      return badRequest('qwen-image: stash needs a sessionId')
    }
    const mediaType = payload?.mediaType
    if (typeof mediaType !== 'string' || !Object.values(MEDIA_TYPES).includes(mediaType)) {
      return badRequest(`qwen-image: ${JSON.stringify(String(mediaType))} is not an accepted image type`)
    }
    const accepted = ctx.get('attachments')?.imageLimits.mediaTypes
    if (accepted !== undefined && !accepted.includes(mediaType)) {
      return badRequest(`qwen-image: this deployment does not accept ${mediaType} images`)
    }
    const data = payload?.data
    if (typeof data !== 'string' || data === '') {
      return badRequest('qwen-image: stash needs base64 image data')
    }

    const cap = byteCap()
    // Screen the encoded length before allocating: base64 is 4 characters per 3
    // bytes, so this rejects an over-cap paste without decoding it first.
    if (data.length > Math.ceil(cap / 3) * 4 + 1024) {
      return badRequest(`qwen-image: the pasted image is larger than this deployment's ${formatBytes(cap)} limit`)
    }
    const bytes = Buffer.from(data, 'base64')
    if (bytes.byteLength === 0) return badRequest('qwen-image: the pasted image decoded to no bytes')
    if (bytes.byteLength > cap) {
      return badRequest(`qwen-image: the pasted image is ${formatBytes(bytes.byteLength)}, over this deployment's ${formatBytes(cap)} limit`)
    }

    const root = workspaceRoot(payload, sessionId)
    if (root === undefined) {
      return badRequest(`qwen-image: session ${JSON.stringify(sessionId)} has no workspace root`)
    }

    const file = stashFileName(mediaType)
    const directory = join(root, STASH_DIR)
    const absolute = join(directory, file)
    try {
      signal?.throwIfAborted()
      await mkdir(directory, { recursive: true })
      await writeFile(absolute, bytes)
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { ok: false, error: { code: 'cancelled', message: 'qwen-image: paste abandoned', details: {} } }
      }
      return unwritable(`qwen-image: could not save the pasted image: ${String(error?.code ?? error)}`, directory)
    }

    const entry = {
      rel: `${STASH_DIR}/${file}`,
      abs: absolute,
      name: displayName(payload?.name, file),
      bytes: bytes.byteLength,
    }
    await stash.add(sessionId, entry)
    ctx.logger.info(`qwen-image: stashed a pasted image for session ${sessionId} at ${entry.rel}`)
    return { ok: true, value: { path: entry.rel, name: entry.name, bytes: entry.bytes } }
  }

  ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload, signal) => {
    if (endpoint === 'stash') return await stashImage(payload, signal)

    const sessionId = payload?.sessionId
    if (endpoint === 'list') {
      if (typeof sessionId !== 'string' || sessionId === '') {
        return badRequest('qwen-image: list needs a sessionId')
      }
      return {
        ok: true,
        value: {
          entries: stash.list(sessionId).map(entry => ({
            path: entry.rel,
            name: entry.name,
            bytes: entry.bytes,
          })),
        },
      }
    }

    if (endpoint === 'drop') {
      if (typeof sessionId !== 'string' || sessionId === '') {
        return badRequest('qwen-image: drop needs a sessionId')
      }
      const path = payload?.path
      if (typeof path !== 'string' || path === '') {
        return badRequest('qwen-image: drop needs the path to forget')
      }
      // A dismissal deletes the bytes: the user said they do not want this image
      // read, and leaving it in the workspace would be litter they did not ask for.
      await stash.forget(sessionId, stash.find(sessionId, path), true)
      return { ok: true, value: { path } }
    }

    // The browser half calls this once to decide whether pasting can be
    // intercepted at all, which matters because the desktop shell forwards
    // fetches through its own bridge rather than the web server. When it fails,
    // that half leaves the app's native paste alone.
    if (endpoint === 'probe') return { ok: true, value: { channel: CHANNEL } }

    return badRequest(`qwen-image: unknown endpoint ${JSON.stringify(endpoint)}`)
  }, { authority: 'loopback' })
}

/**
 * Register the tool.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {ReturnType<typeof Config>} config - resolved configuration.
 */
export function apply(ctx, config) {
  /**
   * Route resolved for this provider topology. Discovery costs one `listModels`
   * per provider — a network call on a gateway adapter — so it must not run per
   * tool call. The cache is invalidated by the seam's own topology event rather
   * than by a timer, so adding a vision provider mid-session takes effect at
   * the next call and no staleness window exists.
   * @type {{ provider: string, model: string } | undefined}
   */
  let resolvedRoute
  ctx.on('llm/adapters-updated', () => { resolvedRoute = undefined })

  /** Pasted images waiting to be read, per session. */
  const stash = new PasteStash()

  /*
   * Tell the model what is waiting. An optional child rather than a hard
   * dependency: a composition with no system-prompt registry still gets the
   * tool, it just cannot be told about a paste it never received either.
   *
   * Order 120 puts this in the tool-guidance band the seam documents (100–199),
   * after the sandbox policy (110) and the approval policy (115) — the two
   * facts that decide whether a file may be touched at all belong before the
   * one that says which file to look at.
   */
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.context({
      name: 'qwen-image:pasted',
      order: 120,
      // Evaluated at every assembly with that assembly's agent, which is how one
      // global registration says something different per session. A bare
      // assemble() (tests, diagnostics) has no session and states nothing.
      text: context => describePending(stash.list(context.agent?.id)),
    })
  })

  /*
   * The stash channel. An optional child for the same reason: a headless or
   * CLI-only deployment composes no connection service, has no browser to
   * paste from, and must still get the tool.
   */
  ctx.inject(['connection', 'sessions'], (wireCtx) => {
    installStashChannel(wireCtx, stash)
  })

  ctx.tools.register(defineTool({
    name: 'qwen_image',
    description:
      'Look at an image and return a text answer about it. Use this whenever you need to read a screenshot, chart, scan, or photo: the image is sent to a separate vision model, so it works even though your own model cannot accept images. It also reads images the user PASTED into the composer — those never appear in the conversation content, so this tool is the only way to see them; omit file_path to take the most recent one. Supports PNG/JPEG/WebP/GIF.',
    parameters: {
      file_path: {
        type: 'string',
        description: 'Path to the image file; absolute, or relative to the session workspace. Omit it to read the most recently pasted image when one is waiting.',
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
    presentCall: (args) => {
      const path = String(args.file_path ?? '').trim()
      // An omitted path is resolved inside `execute`, from state this synchronous
      // presenter cannot see, so the call presents generically and contributes no
      // location. The runtime context lists the paths, so a model that wants to be
      // legible here has one to pass.
      return {
        card: 'generic',
        title: path === '' ? 'Look at the pasted image' : `Look at ${basename(path)}`,
        kind: 'read',
        ...path === '' ? {} : { locations: [{ path }] },
      }
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.id
      const asked = String(args.file_path ?? '').trim()

      /*
       * Which waiting paste this call consumes, if any.
       *
       * Two ways in. An omitted path MEANS "the one that just arrived", which is
       * what makes a bare paste-then-ask work. An explicit path is matched
       * against the list too, so a model that passes the path the runtime context
       * gave it still clears the entry — otherwise the snapshot would keep asking
       * it to look at an image it just looked at.
       */
      let consumed
      let requested = asked
      if (asked === '') {
        const waiting = stash.list(sessionId)
        consumed = waiting[waiting.length - 1]
        if (consumed === undefined) {
          throw new Error(
            'qwen_image: file_path is required. It may be omitted only when the user has just pasted '
            + 'an image into the composer, and no pasted image is waiting in this session.',
          )
        }
        requested = consumed.rel
      } else {
        consumed = stash.find(sessionId, asked)
      }

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

      // Gate on the VISION route, not the session's: the point of this tool is
      // that the calling model need not accept images. Resolving before any I/O
      // keeps a misconfiguration from writing an attachment first.
      resolvedRoute ??= await resolveVisionRoute(ctx, config, exec.signal)
      const route = resolvedRoute

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
        provider: route.provider,
        model: route.model,
        messages,
        system: config.systemPrompt,
        maxTokens: config.maxOutputTokens,
        signal: exec.signal,
      }), exec.signal)

      if (description === '') {
        throw new Error(`qwen_image: "${route.model}" returned no text for "${target.displayPath}"`)
      }
      // Looked at, so it stops being "waiting" — the next assembly's snapshot
      // will not ask again. The bytes stay on disk: the model now holds a path it
      // can pass a second time, and the user can still open the file. A failure
      // above leaves the entry listed on purpose, so a retry is still offered.
      await stash.forget(sessionId, consumed, false)
      return { path: target.displayPath, model: route.model, description }
    },
  }))
}
