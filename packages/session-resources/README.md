# dsh-plugin-session-resources

[![npm](https://img.shields.io/npm/v/dsh-plugin-session-resources)](https://www.npmjs.com/package/dsh-plugin-session-resources)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-black)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

**A ledger of what one session touched.** A Resources tab beside Conversation and Trajectory, listing the files the session **produced** and the files it used as **sources**. Click a row to open the file.

```sh
dsh plugin --profile web add -w dsh-plugin-session-resources
```

## Install

**`-w` is required.** A profile directory is a pnpm workspace root, so without it pnpm refuses with `ERR_PNPM_ADDING_TO_ROOT` and installs nothing.

**Each profile installs separately.** The tab appears only in profiles that carry the package, so a desktop shell needs its own install:

```sh
dsh plugin --profile desktop add -w dsh-plugin-session-resources
```

**No build permission is requested.** The browser half is hand-written plain JS loaded through the app's own module loader, so there is no build step and no `prepare` script — pnpm never asks you to allowlist this package's code at install time.

**There is nothing to configure.** The inventory is folded from what the session log already carries.

To update later:

```sh
dsh plugin --profile web update dsh-plugin-session-resources
```

## This is not a file browser

It never lists a directory, walks a tree, or reads the disk. It reports **what this session did**: two lists derived from the tool activity already in the session log. A file you never touched in this session does not appear, and a file you touched keeps its row after you delete it from disk.

It also differs from the produced-files row the harness ships in the box. That row is **per turn**, sits under the closing message, and by design counts only successful mutations — reads contribute nothing. This tab is **per session** and keeps the reads, because "which files did this work draw on" is the other half of the question and nothing else answers it.

## What the two lists mean

**Produced** is a file a settled, successful mutation call wrote. **Sources** is a file a settled, successful read call opened.

A path appears at most once per list, ordered by the log position of the earliest call that contributed it, and each row names the distinct tools that account for it — so a file written by `write` and then changed by `edit` is one row reading `write · edit`.

A path both roles claim is listed **only under Produced**: a file the session wrote is a deliverable whether or not it was also read on the way there. Listing it twice would report one file as two resources.

Rows are grouped by directory. A directory inside the session's workspace shows only the part below the root, and the workspace root itself gets no header at all, since repeating it on every group is the noise this removes.

### Files outside the workspace are flagged

A directory that is not under the session's workspace keeps its absolute path and carries an **outside workspace** tag.

That tag is the answer to a question this tab tends to raise the first time you open it: *why is a session listing files from somewhere else?* Because the session really did touch them. The harness's file-effect modes are about **writes** — `workspace-write` confines writes to the workspace and its temp areas and leaves reads unrestricted, while `danger-full-access` confines neither — so a session can legitimately read anywhere, and can write anywhere once granted full access or an approved escalation. This tab does not widen anything; it is the surface that makes what already happened visible.

The comparison is deliberately conservative. A workspace-relative path is inside by construction, since resolving it against the session root is what makes it relative. Windows spellings compare case-insensitively, because flagging a workspace directory over a drive letter's case would be a false alarm on exactly the signal that must not cry wolf. With no known workspace root nothing is flagged at all, rather than flagged on a guess.

## How a call becomes an entry

The vocabulary is **render intent, not tool names**: a mutation is a `diff` card or a generic card whose `kind` is `edit` (the shape `str_replace_editor`'s insert presents), and a read is a `read` card or a generic card whose `kind` is `read`. Reading intent rather than names is what lets a file tool nobody has written yet join this ledger by declaring what it does — no allowlist here needs updating.

`tool/call` starts the fold and `tool/result` completes it. That direction is forced rather than chosen: a mutation's file identity can live only in the call view, because a generic `kind: 'edit'` card names its files in call-time `locations` and its result view names none. The result is nevertheless what decides whether the contribution counts — a call that has not settled wrote nothing yet, and a failed call must not claim a file even when its tool already presented a call-time diff. **Both failure signals are honoured**: the internal failure identity (`data.error`, the tool threw) and the model-facing flag (`isError`, the tool reported failure).

Every field below `card` is untrusted. The wire schema locks only the `for` discriminant and the presence of a card-tagged object, so a version mismatch or an anomalous plugin can deliver a `diff` card with no paths or a `locations` entry with no `path`. The classifier narrows structurally and drops what it cannot read, so a malformed view costs one missing row instead of a broken tab.

## Opening a file

Clicking a row hands the path to the Host through the same route the tool rows use, resolving a workspace-relative path against the session's root first. An open that fails stays silent: the native app raises its own dialog when a path is unusable, and a row in a ledger is not the place to report it.

## Known limits

- **The ledger covers the loaded history window.** A call whose `tool/call` has scrolled out of the window leaves a pending context and contributes nothing until an older page supplies its start, so a long session's earliest files are missing until you page back. Making it whole would need a Host-side projection rather than a browser fold.
- **Discovery and web results are excluded.** `glob`/`grep` paths and `web_search` sources are real provenance, but one discovery call can name hundreds of paths nobody opened; folding them in would drown the files the session actually used.
- **Deletes and moves contribute nothing.** A deleted file is not a deliverable, and a move's destination is outside the proven mutation vocabulary, so both are absent rather than guessed.
- **Files touched only by shell commands stay invisible.** A terminal card names a working directory, not files, so a redirect that writes a file records no location to fold.
- **No model sees any of this.** The tab adds no tool, no prompt section, and no request; it cannot be queried from a conversation.

## Removing the tab without uninstalling

Override the row by id in the profile's own `cordis.patch.yml` — do not `insert` it again, since a second insert of the same id fails the boot with `duplicate loader entry id`:

```yaml
- id: session-resources
  disabled: true
```

## Development

Installing from a local checkout needs the `file:` prefix, which is copy rather than link semantics:

```sh
dsh plugin --profile web add -w "file:/path/to/dsh-plugins/packages/session-resources"
```

After editing the source, refresh that copy:

```sh
dsh plugin --profile web install
```

The host half is deliberately empty. It exists because a profile composes packages through loader rows and a row needs a module to mount; the row is what carries the package into the composition, which is what makes the web app read the `dsh.client` declaration.

## License

[MIT](LICENSE)
