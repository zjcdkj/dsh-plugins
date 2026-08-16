# Changelog

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
