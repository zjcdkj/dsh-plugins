# dsh-plugin-qwen-image

[![npm](https://img.shields.io/npm/v/dsh-plugin-qwen-image)](https://www.npmjs.com/package/dsh-plugin-qwen-image)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-black)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

**Give a text-only coding model eyes.** An image goes to a vision route and comes back as **text**, so DeepSeek keeps driving the session while Qwen does the looking. **Pasting a screenshot into the composer works too** — and not one character of your draft is touched.

```sh
dsh plugin --profile web add -w dsh-plugin-qwen-image
```

![qwen_image reading a slide inside a DeepSeek session](https://raw.githubusercontent.com/zjcdkj/dsh-plugins/main/packages/qwen-image/assets/demo.png)

## Install

**`-w` is required.** A profile directory is a pnpm workspace root, so without it pnpm refuses with `ERR_PNPM_ADDING_TO_ROOT` and installs nothing.

**No build permission is requested.** Pure ESM, no build step, so there is no `prepare` script. pnpm ≥10 blocks a git dependency's build until you explicitly allowlist it — and that allowance is permission to execute the package's code on your machine at install time. This package never asks for it.

**Works on rc.5 and rc.6.** The peer range is `^0.1.0-rc.5`, so it loads both in the current release and in older desktop shells still pinned to rc.5.

To update later:

```sh
dsh plugin --profile web update dsh-plugin-qwen-image
```

That reaches releases inside the range the install wrote, and needs no `-w`. On a `0.x` version npm's caret stops below the next minor, so `^0.3.0` picks up `0.3.x` but not `0.4.0` — crossing a minor means running the install command again. [CHANGELOG.md](CHANGELOG.md) records what each release changed.

## A vision route

The tool needs one model that accepts images.

**If your dsh already has one, there is nothing to configure.** On the first call the plugin tries the route it is pointed at; when that route is not usable it scans every registered provider, takes the first model that declares image input, and logs which one it chose. The scan runs once per provider topology, not once per call.

If you have none, declare one in `$DSH_HOME/settings.yaml`:

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

and the key in `$DSH_HOME/.credentials.yaml`, where managed credentials never reach `process.env`:

```yaml
DASHSCOPE_API_KEY: sk-...
```

`input: [text, image]` is the whole switch. A model entry that omits it is reported as accepting text only, so the plugin will not pick it — an unknown capability is treated as absent rather than guessed at, because guessing turns a settings mistake into a provider `400`. A route-level `defaultInput: [text, image]` works too, for a gateway whose models all accept images.

**Settings → Models → Add custom provider** does the same thing through the UI and stores the key write-only. The provider id it generates does not have to be `dashscope`; the scan finds it either way.

When no model anywhere declares image input, the call fails with the route it looked for, every provider it scanned, and the block to add — not a bare error code.

## Pasting a screenshot

**Paste it or drop it in, then just ask.**

Without this plugin that fails, and it fails late: the app accepts the image into its own rail, you send, and the Host refuses the whole request — *"Model … does not support image input"*. The image was never the problem; putting it in the conversation was.

So the paste is taken before the app sees it. The bytes are saved under `<workspace>/.dsh-pasted/` and the runtime context states that an image is waiting. **The conversation still carries no image part, which is exactly why the request goes through.**

A "waiting to be read" strip appears above the composer with a thumbnail and a dismiss button. When nothing is waiting, the strip is **not there at all**.

The boundaries, stated plainly:

- **It does not write to the composer.** No injected path, no typing on your behalf. The draft holds only what you wrote.
- **A mixed paste works too.** The image goes to the channel and the text is handed **straight back** to the app, so it behaves like pasting either one alone.
- **Only the composer.** A paste into the session search field is untouched, and so is a text-only paste anywhere.
- **An unreachable channel means no interception at all.** The browser half probes first, and until that succeeds — and forever, on a deployment with no host half — the app's native paste is exactly as it was. Cancelling a paste it could not complete would destroy the clipboard for nothing.
- **Reading it clears the reminder but keeps the file.** After the model looks, the image leaves the waiting list while the file stays in the workspace: you can still open it and the model can pass the same path again. Only the dismiss button deletes it.
- At most 8 images per session and 64 sessions tracked; eviction removes the file too.

Every stored filename is generated **by the host**: a caller supplies bytes and a media type, never a path or a name, so the channel has no traversal surface. On top of that it is `authority: 'loopback'`, so only a page on this machine can call it. Byte caps come from `ctx.attachments.imageLimits`, so an image accepted here is one the vision request can actually carry.

If the workspace is a git repository, add this line to `.gitignore` and pasted screenshots stay out of `git status`:

```gitignore
.dsh-pasted/
```

Inside the workspace rather than a temp directory, so the model receives a path it can hand to any other tool, `ctx.fs` reads it without a sandbox exception, and you can see and delete what accumulated.

CLI and headless deployments are unaffected: `connection`, `sessions` and `systemPrompt` are optional children, so with no browser you get the tool and no paste path.

## The tool the model sees

`qwen_image(file_path?, question?)`

PNG / JPEG / WebP / GIF. Omit `question` for a general description plus a verbatim transcription of any text in the image. A relative `file_path` resolves against the **calling session's workspace**, not the server's launch directory.

**`file_path` may be omitted** — it then reads the most recently pasted image in this session. Omitting it with nothing waiting fails, and says so.

It returns the resolved path, the vision model that answered, and that model's text.

## Why this instead of `read_image`

The built-in `read_image` puts the image into the **session's own** route, so it refuses unless that exact model accepts image input. DeepSeek does not, so you get a refusal.

This plugin inverts it: the image travels to an independent vision route, and only **text** comes back. The calling model never needs any multimodal capability at all.

Everything it touches is a public seam — `ctx.tools`, `ctx.llm`, `ctx.fs`, `ctx.attachments` — so it installs into a profile and needs **no change to the harness and no desktop rebuild**.

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
| `provider` | `dashscope` | preferred provider id; falls back to any discovered vision route |
| `model` | `qwen3-vl-plus` | preferred vision model id; falls back the same way |
| `systemPrompt` | see source | system prompt sent to the vision model |
| `maxOutputTokens` | `1024` | output cap for one vision answer |
| `timeoutMs` | `120000` | cooperative timeout budget per call |

`provider` and `model` are a preference, not a requirement: naming a route that does not exist costs a log line, not a failure. Name one you actually have when you want a specific model — with several vision routes configured, the scan takes the first registered, which is the deployment's own order and not necessarily the one you meant.

## Known limits

- **No URLs.** Save a remote image to disk first (pasting and dropping are supported, see above).
- **One image per call.** Call again for more.
- **The waiting list is in memory.** A Host restart loses it — the bytes are still on disk, but the "an image is waiting" reminder stops appearing. That costs a re-paste, and buys not writing into a session log this plugin does not own.
- **The strip clears a few seconds late.** The browser half learns that the host has read an image by polling (only while something waits, stopping as soon as the list empties), so there is a short gap between the model looking and the chip going.
- **No retries.** A transient failure on the vision route propagates as-is; retry policy belongs to that route's own `retryPolicy`.
- **Byte caps come from the deployment.** The per-image cap is the smaller of the two bounds in `ctx.attachments.imageLimits`; this plugin sets no threshold of its own.
- **A route that stops working is noticed at the next topology change.** The resolved route is cached until the harness reports that providers changed, so revoking a credential surfaces as that provider's own failure rather than an automatic switch.

## Design notes

**The image never enters the caller's context.** The tool returns plain text, so the calling model needs no multimodal capability. That is the whole difference from `read_image`.

**The capability check targets the vision route, not the session's** — and it runs before any I/O, so a misconfiguration cannot write an attachment first.

**Bytes are committed durably through `ctx.attachments`.** An `ImageBlock` carries a durable attachment reference rather than raw bytes, so this step is required; it also makes the request replayable.

**Files are read through `ctx.fs`, never `node:fs`.** Sandboxing and remote execution follow for free — point the fs provider at a remote sandbox and this plugin moves with it.

**Relative paths anchor to the session workspace.** Resolution carries `exec.agent.session.header.cwd` (canonicalized when `..` is involved), matching the in-box filesystem tools. Without it, `slide_05.png` resolves against the dsh process cwd.

**It declares `kind: 'read'` and `locations`.** A resource or deliverables surface can then count the image as a source without knowing this tool's name.

**The paste is claimed in the browser, not rewritten in the host.** There is no seam for the latter: `intercept('/api', …)` is a single global seat already held by the API gateway, and no hook exists to rewrite message content before submit. In the browser it takes only a capture-phase listener — the app's own handling is a React `onPaste` on the textarea plus a document-level `drop`, both later than capture.

**Runtime context, not a prompt section.** "An image is waiting" is a fact about right now, not a persona: the harness re-states it each assembly and supersedes it with the next snapshot, so when the waiting list empties the text disappears on its own.

**One global registration, different content per session.** `AssembleContext` carries the `agent` for that assembly, so the `text` function reads `context.agent.id` and looks up that session's list — no need to watch `agent/created` and register once per session.

**Not writing to the composer is a hard constraint.** The other way to make pasting "work" is to save the file and inject a path line into the draft (no image part in the message, so the Host's gate never fires). This plugin does not do that: the composer is yours. The text half of a mixed paste is handed back for the same reason — those characters are your own clipboard contents, going where you aimed them.

## Development

Installing from a local checkout needs the `file:` prefix:

```sh
dsh plugin --profile web add -w "file:/path/to/dsh-plugins/packages/qwen-image"
```

**A bare path breaks peer resolution.** A bare directory path takes pnpm's `link:` semantics and installs a symlink. Node resolves peers from the **real** path, walking up from your checkout instead of the profile, and the plugin fails to load with `Cannot find package '@deepseek-ai/schemastery'`. `file:` puts the package inside the profile's `node_modules` tree instead — the directory is a junction into pnpm's store, and each file in it is a hard link to the file in your checkout — so parent-walk reaches `$DSH_HOME/profiles/node_modules`, the installation-level fallback.

After adding or deleting a file, re-link:

```sh
dsh plugin --profile web install
```

## License

[MIT](LICENSE)
