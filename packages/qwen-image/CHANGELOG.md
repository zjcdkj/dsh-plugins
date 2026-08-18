# Changelog

## 0.3.0

**Pasting an image into the composer now works.** Paste or drop a screenshot and
ask about it in the same message; the model reads it with `qwen_image`. The
composer's text is never touched — no injected path, no draft you did not type.

Before this, pasting failed and it failed late: the app accepted the image into
its own rail, you sent, and the Host refused the whole request with *"Model … does
not support image input"*. The image was never the problem; putting it in the
conversation was.

So the paste is taken before the app sees it. A new browser half claims the event
in the capture phase, hands the bytes to this package's host half over a channel
of its own, and the host saves them under `<workspace>/.dsh-pasted/` and states
in the runtime context that an image is waiting. The conversation still carries
no image part, which is exactly why the request goes through.

- `file_path` is now **optional**: omit it to read the most recent pasted image
- a strip above the composer lists what is waiting, with a thumbnail and a
  dismiss button; dismissing deletes the file, and the strip is absent entirely
  when nothing waits
- the waiting list is per session, and the prompt text is evaluated per assembly
  from that assembly's agent, so one conversation never sees another's pastes
- reading an image drops it from the waiting list but **keeps the file**, so the
  model can pass the same path again and you can still open it
- a mixed paste (image *and* text) is handled too: the image goes to the channel
  and the text is handed straight back to the app, so it behaves like pasting
  either one alone
- a paste outside the composer, or one carrying only text, is not touched
- the browser half **probes the channel first** and leaves the app's native paste
  completely alone until that succeeds — cancelling a paste it could not complete
  would destroy the clipboard for nothing
- `connection`, `sessions` and `systemPrompt` are optional children, so a
  CLI-only or headless composition still gets the tool with no paste path and no
  waiting registration
- the host generates every stored filename; the caller supplies bytes and a media
  type but never a path or a name, so the channel has no traversal surface. It is
  `authority: 'loopback'` on top of that
- byte caps come from `ctx.attachments.imageLimits`, so a paste accepted here is
  one the vision request can actually carry
- per session at most 8 images are held and at most 64 sessions are tracked;
  eviction removes the file too

Docs: both READMEs gain a paste section, and the "no clipboard data" limitation
is gone because it is no longer true.

> Upgrading from 0.2.0: npm's caret on a `0.x` version stops below the next
> minor, so `^0.2.0` does not include `0.3.0` and `dsh plugin update` will not
> cross it. Run the install command again to move the range. The paste strip
> needs the browser half, which is a new file — after updating a `file:`
> checkout, run `dsh plugin --profile web install` so it gets linked.

## 0.2.0

**Installing no longer requires editing settings.** The configured route is now
a preference: when it is not usable the plugin scans every registered provider
and uses the first model that declares image input, so a dsh that already
reaches a vision model needs no configuration at all.

Before this, the defaults only worked if your provider id was exactly
`dashscope`. Any other id — including the one **Settings → Models → Add custom
provider** generates — reached `resolveModelInfo` and raised `NO_ADAPTER`, an
error the plugin never caught, so the operator saw a bare framework code with no
indication of what to fix.

- when nothing anywhere declares image input, the failure names the route it
  looked for, every provider it scanned, and the settings block to add
- a provider whose model listing fails (expired credential, unreachable
  gateway) is skipped instead of aborting the scan
- any non-`NO_ADAPTER` llm failure still propagates unchanged: an aborted call
  or invalid metadata belongs to the caller, not to this fallback
- the scan stops at the first hit and its result is cached until the harness
  reports that providers changed, so listing costs at most one pass per topology
  rather than one per tool call
- a substitution is logged once per topology, naming the route chosen and why
  the configured one was not
- **the reported `model` is now the route that actually answered**, not the
  configured id, so the two cannot disagree
- a model with no declared modalities is not picked. The harness documents
  absent modalities as unknown and an explicit omission as negative capability,
  so guessing would trade a settings mistake for a provider `400`

Docs: both READMEs are reordered so the four sections a new user needs come
first, and the update command and the `-w` requirement are stated explicitly.

> Upgrading from 0.1.0: npm's caret on a `0.x` version stops below the next
> minor, so `^0.1.0` does not include `0.2.0` and `dsh plugin update` will not
> cross it. Run the install command again to move the range.

## 0.1.0

First release. One tool, `qwen_image(file_path, question?)`, that routes a local
image to a Qwen-VL route through `ctx.llm` and returns plain text, so a
text-only model can read screenshots, charts and scans without any multimodal
capability of its own.

- public seams only (`ctx.tools`, `ctx.llm`, `ctx.fs`, `ctx.attachments`): no
  harness change and no desktop rebuild
- pure ESM with no build step, so installing never requests build permission
- peer range from `^0.1.0-rc.5`, loading on both rc.5 and rc.6
- relative paths resolve against the calling session's workspace, matching the
  in-box filesystem tools
- declares `kind: 'read'` and `locations`, so a resource or deliverables surface
  can count the image as a source without knowing this tool's name
