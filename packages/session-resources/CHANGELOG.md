# Changelog

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
