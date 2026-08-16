# dsh-plugin-qwen-image

[![npm](https://img.shields.io/npm/v/dsh-plugin-qwen-image)](https://www.npmjs.com/package/dsh-plugin-qwen-image)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-black)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

**Give a text-only coding model eyes.** Images go to a separately configured Qwen-VL route and come back as **text**, so DeepSeek keeps driving the session while Qwen does the looking.

```sh
dsh plugin --profile web add -w dsh-plugin-qwen-image
```

![qwen_image reading a slide inside a DeepSeek session](https://raw.githubusercontent.com/zjcdkj/dsh-plugins/main/packages/qwen-image/assets/demo.png)

## Why this instead of `read_image`

The built-in `read_image` puts the image into the **session's own** route, so it refuses unless that exact model accepts image input. DeepSeek does not, so you get a refusal.

This plugin inverts it: the image travels to an independent vision route, and only **text** comes back. The calling model never needs any multimodal capability at all.

Everything it touches is a public seam — `ctx.tools`, `ctx.llm`, `ctx.fs`, `ctx.attachments` — so it installs into a profile and needs **no change to the harness and no desktop rebuild**.

## Two things that may matter to you

**No build permission required.** Pure ESM, no build step, so no `prepare` script. pnpm ≥10 blocks a git dependency's build until you explicitly allowlist it — and that allowance is permission to execute the package's code on your machine at install time. This package never asks for it.

**Works on rc.5 and rc.6.** The peer range is `^0.1.0-rc.5`, so it loads both in the current release and in older desktop shells still pinned to rc.5.

## Prerequisite: declare a vision route

Add a provider to `llm-pi-ai` in `$DSH_HOME/settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    dashscope:
      displayName: Qwen DashScope
      apiKeyEnv: DASHSCOPE_API_KEY
      api: openai-completions
      baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
      models:
        - id: qwen3-vl-plus
          name: Qwen3-VL Plus
          input: [text, image]        # <- without this line the model declares [text] only
```

Put the key in `$DSH_HOME/.credentials.yaml` (managed credentials never reach `process.env`):

```yaml
DASHSCOPE_API_KEY: sk-...
```

`input: [text, image]` is the whole switch — declaring images is what makes a hand-declared vision model usable. **Settings → Models → Add custom provider** does the same thing through the UI, storing the key write-only.

## The tool the model sees

`qwen_image(file_path, question?)`

PNG / JPEG / WebP / GIF. Omit `question` for a general description plus a verbatim transcription of any text in the image. A relative `file_path` resolves against the **calling session's workspace**, not the server's launch directory.

## Configuration

Installing puts this package in the profile's `dsh.profile.bundles`, and its own bundle patch **already inserted** the `qwen-image` row. To change settings, **override that row by id** in the profile's `cordis.patch.yml`:

```yaml
- id: qwen-image
  name: dsh-plugin-qwen-image      # optional assertion: a name mismatch skips with a warning
  config:
    provider: dashscope
    model: qwen3-vl-flash
```

Do not write another `insert:` — inserting the same id twice fails the boot with `duplicate loader entry id`. Also `config` **replaces wholesale** rather than deep-merging, so spell out every field you want to depart from the defaults.

| Field | Default | Meaning |
|---|---|---|
| `provider` | `dashscope` | provider id of the vision route |
| `model` | `qwen3-vl-plus` | vision model id; must declare `input: [text, image]` |
| `systemPrompt` | see source | system prompt sent to the vision model |
| `maxOutputTokens` | `1024` | output cap for one vision answer |
| `timeoutMs` | `120000` | cooperative timeout budget per call |

## Installing from a local checkout

The `file:` prefix is **required**:

```sh
dsh plugin --profile web add -w "file:/path/to/dsh-plugin-qwen-image"
```

Two traps worth knowing:

- **`-w` is required.** A profile directory is a pnpm workspace root; without it you get `ERR_PNPM_ADDING_TO_ROOT`.
- **A bare path breaks peer resolution.** A bare directory path takes pnpm's `link:` semantics and installs a symlink. Node resolves peers from the **real** path, walking up from your checkout instead of the profile, and the plugin fails to load with `Cannot find package '@deepseek-ai/schemastery'`. `file:` is copy semantics: the package lands inside the profile's `node_modules`, so parent-walk reaches `$DSH_HOME/profiles/node_modules`, the installation-level fallback.

After editing the source, refresh that copy with `dsh plugin --profile web install`.

## Design notes

**The image never enters the caller's context.** The tool returns plain text, so the calling model needs no multimodal capability. That is the whole difference from `read_image`.

**The capability check targets the configured route, not the session's** — and it runs before any I/O, so a misconfiguration cannot write an attachment first.

**Bytes are committed durably through `ctx.attachments`.** An `ImageBlock` carries a durable attachment reference rather than raw bytes, so this step is required; it also makes the request replayable.

**Files are read through `ctx.fs`, never `node:fs`.** Sandboxing and remote execution follow for free — point the fs provider at a remote sandbox and this plugin moves with it.

**Relative paths anchor to the session workspace.** Resolution carries `exec.agent.session.header.cwd` (canonicalized when `..` is involved), matching the in-box filesystem tools. Without it, `slide_05.png` resolves against the dsh process cwd.

**It declares `kind: 'read'` and `locations`.** A resource or deliverables surface can then count the image as a source without knowing this tool's name.

## Known limits

- **Local paths only.** No URLs, no clipboard data; save a remote image to disk first.
- **One image per call.** Call again for more.
- **No retries.** A transient failure on the vision route propagates as-is; retry policy belongs to that route's own `retryPolicy`.
- **Byte caps come from the deployment.** The per-image cap is the smaller of the two bounds in `ctx.attachments.imageLimits`; this plugin sets no threshold of its own.

## License

[MIT](LICENSE)
