# Changelog

## 0.2.0

The tab became a panel, and the ledger became a file tree with the ledger folded
into it. A session's workspace is now something you can walk, not just a list of
what got touched.

**Breaking in effect, not in API.** There is no configuration and no exported
surface to break, but the Resources tab is gone: what was a tab beside
Conversation and Trajectory is now a panel on the conversation's right, opened
from a button beside `Session log`. A profile that carried 0.1.0 needs no change
beyond the update.

### The workspace tree

- **the session's project directory, one level at a time.** A folder is fetched
  when first opened and then kept, so collapsing and reopening costs nothing.
  Directories sort before files; a large directory is capped at 500 entries and
  says so rather than presenting a partial listing as complete
- **served over a channel of this plugin's own**, because the app's
  `host.listDirectory` backs the directory picker and drops every non-directory
  entry on purpose — nothing else in the RPC map reports file names. The channel is
  registered through `connection.rpc.handle`, which puts it behind the same
  request fence the `/api` route uses
- **fenced twice**: loopback-only, so only a page on this machine can call it; and
  every path resolved against the asking session's workspace root and checked with
  `fs.contains`, so `..` and an absolute path elsewhere are both refused. An
  attached session's root comes from the session store rather than the caller
- **a filter box** over the folders you have opened. It reaches what has been
  loaded and no further, rather than walking the disk on every keystroke
- **reload** in the header, because there is no file watcher: a side panel that
  kept itself current would be a lot of machinery for a question a button answers

### Produced here

- **the files this session wrote, pinned above the tree.** The tree contains them
  too; this repeats them on purpose, because a directory listing cannot answer
  "what did this conversation just make"
- **a dot on every touched row** — filled for produced, hollow for read — replacing
  the tool names that used to sit beside the filename as text. Which tools account
  for a file moved into the dot's tooltip: worth keeping, not worth the width

### When there is no listing

- **the two lists from 0.1.0 are the fallback**, said in one line rather than left
  as an empty panel. A composition without the filesystem service, or a shell that
  does not forward the channel, still gets the files this session produced and the
  files it used as sources — folded from tool activity already in the session log,
  needing nothing from the Host
- that fold is also what drives the dots and the pinned section, so it is a real
  surface rather than an apology

### Layout

- **the session header never moves.** What gives up width is the scrolling body
  under it; the title, the utility row and the conversation tabs keep their full
  width, and the messages re-centre themselves in what is left
- **drag to resize** between 240 and 720 pixels, arrow keys included, with the
  app's own 12×32 pill as the grab affordance
- **the app's left edge, fill, and quiet scrollbar**, so light and dark follow the
  host with no theme awareness here. The scrollbar is transparent until the pointer
  is in the panel: a file list overflows by a little, which puts the thumb at two
  thirds of the track where it reads as a rule down the edge rather than a position
- **a folder button reveals a row's directory**, and one in the header reveals the
  workspace root — both only when the Host reports it can reach a desktop and the
  page is the local one, which is the condition the app puts on its own
  produced-files shortcut

### Icons

- **nine multicolour badges and twelve Lucide outlines**, badge first and outline
  as the fallback, carried across from an icon set whose own entry component pairs
  them that way
- **twenty-two per-language code badges** — `PY`, `TS`, `TSX`, `RS`, `GO` and the
  rest — composed from the page, folded corner and band the set's own document
  badges share, so they are siblings rather than a second visual language. The
  label does the distinguishing, not the colour: four of these languages are
  conventionally blue, and at 16px four blues are one blue
- **a generator, not transcription.** `assets/file-icons/generate.mjs` rewrites the
  four data literals in `lib/client.js` from the vendored sources and checks the
  claims the code makes: no `id` or gradient survives, every label is 1–4 safe
  capitals, no extension is claimed twice, and no extension the manifest mapped
  changed which outline it falls back to
- the vendored Lucide outlines are ISC; the licence ships beside them

### Host half

- **no longer empty.** It registers the listing channel and nothing else — no tool,
  no prompt section, no request. Nothing here reaches a model

## 0.1.0

First release. A Resources tab beside Conversation and Trajectory listing the
files one session produced and the files it used as sources, folded from tool
render intent already present in the session log.

- **not a file browser**: no directory is listed, no tree is walked, no disk is
  read. A file appears because this session touched it, and keeps its row after
  you delete it
- **per session, and it keeps the reads.** The produced-files row the harness
  ships in the box is per turn and counts only successful mutations; "which
  files did this work draw on" is the other half of the question
- recognized by **render intent, not tool names** — a `diff` card or a generic
  card whose `kind` is `edit` is a mutation, a `read` card or `kind: 'read'` is a
  read — so a file tool nobody has written yet joins by declaring what it does
- a path both roles claim is listed only under Produced: a file the session
  wrote is a deliverable whether or not it was also read on the way there
- each row names every distinct tool that accounts for it
- **failure is honoured on both signals**: the internal failure identity
  (`data.error`, the tool threw) and the model-facing flag (`isError`, the tool
  reported failure). An unsettled call contributes nothing either
- every field below `card` is treated as untrusted and narrowed structurally, so
  a malformed view costs one missing row rather than a broken tab
- **click a row to open the file**, resolving a workspace-relative path against
  the session root first, through the same Host route the tool rows use
- rows group by directory; a directory inside the workspace is stripped to its
  remainder and the workspace root gets no header at all
- **directories outside the workspace are flagged.** The harness's file-effect
  modes govern writes — `workspace-write` leaves reads unrestricted — so a
  session can read anywhere, and this is the surface that makes that visible.
  The comparison stays conservative: relative paths are inside by construction,
  Windows spellings compare case-insensitively, and an unknown workspace root
  flags nothing
- **no build permission at install.** The browser half is hand-written plain JS
  loaded through the app's own module loader
- **nothing reaches a model.** No tool, no prompt section, no request; the host
  half is deliberately empty
