# dsh-plugin-session-resources

[![npm](https://img.shields.io/npm/v/dsh-plugin-session-resources)](https://www.npmjs.com/package/dsh-plugin-session-resources)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-black)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

**A file panel beside the conversation.** The session's workspace as a tree you
can walk, the files this session produced pinned above it, and a dot on every row
the session touched. Click a file to open it; the conversation makes room rather
than being covered.

```sh
dsh plugin --profile web add -w dsh-plugin-session-resources
```

## Install

**`-w` is required.** A profile directory is a pnpm workspace root, so without it
pnpm refuses with `ERR_PNPM_ADDING_TO_ROOT` and installs nothing.

**Each profile installs separately.** The panel appears only in profiles that
carry the package, so a desktop shell needs its own install:

```sh
dsh plugin --profile desktop add -w dsh-plugin-session-resources
```

**No build permission is requested.** The browser half is hand-written plain JS
loaded through the app's own module loader, so there is no build step and no
`prepare` script — pnpm never asks you to allowlist this package's code.

**There is nothing to configure.**

To update later:

```sh
dsh plugin --profile web update dsh-plugin-session-resources
```

## What the panel shows

A button beside `Session log` opens it. Three things share the surface:

**Produced here** is pinned at the top: the files this session wrote. The tree
below contains them too — they are on disk like everything else — so this repeats
them on purpose. A directory listing answers "what is here"; it cannot answer
"what did this conversation just make", and that is the question a reader has the
moment a turn finishes. Hunting for the answer among two hundred sibling files is
the work this removes.

**The workspace tree** is the session's own project directory, one level fetched
when you first open a folder and then kept, so collapsing and reopening costs
nothing. Directories sort before files. A large directory is capped and says so
rather than pretending a partial listing is complete.

**A dot** marks a row this session touched: filled for a file it produced, hollow
for one it only read. Which tools account for it is in the dot's tooltip — worth
keeping, and not worth the width it took when it sat beside the filename as text.

The filter box narrows to matching names across the folders you have opened. It
reaches what has been loaded and no further, which is honest: an unopened folder's
contents are not on this side to search, and walking the whole disk on every
keystroke would be a different feature.

## Where the listing comes from

The app's own `host.listDirectory` cannot serve this. It backs the directory
picker, where a file is not a destination, so it drops every non-directory entry
on purpose — and nothing else in the RPC map reports file names.

So the host half answers on a channel of its own, registered through
`connection.rpc.handle`, which is the supported way to add one: it puts the
channel behind the same request fence the `/api` route uses and ties the
registration to this plugin's fiber. The listing itself is `fs.listDir`, the one
directory read in the app that reports files as well as folders.

**The listing is fenced twice.** The channel is loopback-only, so only a page on
this machine can call it at all. Inside that, every path is resolved against the
asking session's own workspace root and checked with `fs.contains`, so `..` and an
absolute path elsewhere are both refused. For an attached session the root is read
from the session store rather than accepted from the caller; for a session that is
merely open in history — which the store does not answer for — it comes from the
caller, and the containment check is what carries the weight.

**Nothing reaches a model.** No tool, no prompt section, no request. The panel
cannot be queried from a conversation.

## When there is no listing

Some deployments cannot serve one: a composition without the filesystem service,
or a shell that does not forward this channel. The panel says so in one line and
falls back to two lists that need nothing from the Host — the files this session
produced and the files it used as sources, folded from tool activity already in
the session log.

That fallback is the whole of what this plugin used to be, and it is still what
drives the dots and the pinned section, so it is a real surface rather than an
apology.

## How a call becomes an entry

The vocabulary is **render intent, not tool names**: a mutation is a `diff` card or
a generic card whose `kind` is `edit` (the shape `str_replace_editor`'s insert
presents), and a read is a `read` card or a generic card whose `kind` is `read`.
Reading intent rather than names is what lets a file tool nobody has written yet
join this ledger by declaring what it does — no allowlist here needs updating.

`tool/call` starts the fold and `tool/result` completes it. That direction is
forced rather than chosen: a mutation's file identity can live only in the call
view, because a generic `kind: 'edit'` card names its files in call-time
`locations` and its result view names none. The result is nevertheless what
decides whether the contribution counts — a call that has not settled wrote
nothing yet, and a failed call must not claim a file even when its tool already
presented a call-time diff. **Both failure signals are honoured**: the internal
failure identity (`data.error`, the tool threw) and the model-facing flag
(`isError`, the tool reported failure).

A path both roles claim counts as produced: a file the session wrote is a
deliverable whether or not it was also read on the way there.

Every field below `card` is untrusted. The wire schema locks only the `for`
discriminant and the presence of a card-tagged object, so a version mismatch or an
anomalous plugin can deliver a `diff` card with no paths or a `locations` entry
with no `path`. The classifier narrows structurally and drops what it cannot read,
so a malformed view costs one missing mark instead of a broken panel.

## Opening a file, and revealing a folder

Clicking a row hands the path to the Host through the same route the tool rows
use. An open that fails stays silent: the native app raises its own dialog when a
path is unusable, and a row in a file list is not the place to report it.

The folder button on a row — and the one in the header, for the workspace root —
appears only when the Host reports it can reach a desktop **and** the page is the
local one. A browser on another machine must not be able to make the Host's
desktop open windows, which is the same condition the app puts on its own
produced-files shortcut.

## Layout

The panel is a region to the right of the conversation body, starting under the
session header. Dragging its edge resizes it between 240 and 720 pixels, arrow
keys included.

**The session header never moves.** What gives up width is the scrolling body
under it, which is the part a reader is looking at; the title, the utility row and
the conversation tabs keep their full width. The messages re-centre themselves in
what is left, because they were already held by automatic margins.

Colours, the left edge, the resize pill and the quiet scrollbar are the app's own
tokens and patterns rather than choices made here, so light and dark follow the
host with no theme awareness in this package.

## Icons

Nine multicolour badges and twelve Lucide outlines, badge first and outline as the
fallback, plus twenty-two per-language code badges composed from the same page
geometry. Sources, the family table and the generator that produces the constants
are in [`assets/file-icons/`](assets/file-icons/README.md).

## Known limits

- **The ledger covers the loaded history window.** A call whose `tool/call` has
  scrolled out of the window leaves a pending context and contributes nothing
  until an older page supplies its start, so a long session's earliest marks are
  missing until you page back. The tree is unaffected — it reads disk.
- **The tree does not watch for changes.** It is fetched when you open a folder
  and kept until you reload, which the header button does. A file watcher for a
  side panel would be a lot of machinery for a question a button answers.
- **Discovery and web results are excluded** from the ledger. `glob`/`grep` paths
  and `web_search` sources are real provenance, but one discovery call can name
  hundreds of paths nobody opened.
- **Deletes and moves contribute no marks.** A deleted file is not a deliverable,
  and a move's destination is outside the proven mutation vocabulary.
- **Files touched only by shell commands stay unmarked.** A terminal card names a
  working directory, not files, so a redirect that writes a file records no
  location to fold. It still appears in the tree, because the tree reads disk.
- **A session with no workspace root has no tree.** Saying so beats falling back to
  some other directory the reader never asked about.

## Removing the panel without uninstalling

Override the row by id in the profile's own `cordis.patch.yml` — do not `insert`
it again, since a second insert of the same id fails the boot with
`duplicate loader entry id`:

```yaml
- id: session-resources
  disabled: true
```

## Development

Installing from a local checkout needs the `file:` prefix:

```sh
dsh plugin --profile web add -w "file:/path/to/dsh-plugins/packages/session-resources"
```

pnpm links rather than copies: the package directory in the profile's
`node_modules` is a junction into the store, and each file inside it is a **hard
link to the file in your checkout** — one inode, several names. Editing a file in
place therefore reaches every profile at once, with no install step.

Adding or deleting a file is the case that needs one, since a new file has no link
yet. So does any editor that saves by writing a temporary file and renaming it
over the original, which replaces the inode and quietly leaves the profile
pointing at the old content. Re-linking is cheap, so the habit worth having is to
run it after a change rather than to reason about which kind it was:

```sh
dsh plugin --profile web install
```

**A running app does not re-read any of this.** The browser picks up a client
change on reload, but the host half is loaded once at boot — restart `dsh web`
after touching it. The desktop shell loads both at startup, so it needs a restart
either way.

## License

[MIT](LICENSE). The vendored Lucide outlines are ISC; see
[`assets/file-icons/LUCIDE-LICENSE.txt`](assets/file-icons/LUCIDE-LICENSE.txt).
