# File icons

The sources for the icon data in `lib/client.js`. Nothing here is loaded at
runtime — the browser half carries the geometry as string constants, generated
from these files, so a row costs no request.

## What is here

| | |
| --- | --- |
| 9 multicolour badges | `docx` `html` `jpg` `json` `md` `pdf` `pptx` `txt` `xlsx` |
| 12 Lucide outlines | `File` `FileText` `FileCode` `FileImage` `FileSpreadsheet` `FileMusic` `FileArchive` `Film` `Braces` `Globe` `Presentation` `BookOpen` |
| `manifest.json` | which family uses which badge, which outline backs it up, and which extensions belong to it |
| `generate.mjs` | rewrites four literals in `lib/client.js` from the two above |

The badges and the family table come from a private icon set whose entry
component pairs each file family with a local drawing and a Lucide glyph to fall
back on. That pairing is a design decision, so it was carried across rather than
re-made here: `manifest.json` is that set's own record, trimmed to the three
sections this package reads and with its paths rewritten to the flat layout in
this directory.

## Two kinds of art, on purpose

The badges are multicolour and carry their own contrast — a light page with a
coloured band reads as a distinct card on both the light and the dark theme —
so they are **not** recoloured to follow the row they sit in. The Lucide
outlines are the opposite: single-colour strokes that inherit the row's colour
through `currentColor`, covering the formats no badge was drawn for.

Badge first, outline as the fallback, which is the arrangement the icon set
itself documents.

## Code badges are composed, not drawn

There are 22 more badges — `PY`, `TS`, `TSX`, `RS`, `GO` and so on — and no files
for them. They are built at load time from the page, folded corner and bottom
band that this set's own `txt`, `md`, `html`, `json` and `pptx` badges all share,
read back out of `txt.svg`. Only the band colour and the label change, so they
are siblings of the document badges rather than a second visual language.

Their table lives in `lib/client.js` as `CODE_BADGES`, not here: which languages
get a badge and in what colour is a design input, so it belongs beside the code
that draws it. `generate.mjs` reads it and derives the family table from it.

Two things about that table are worth knowing before editing it. The label is
what distinguishes a badge at 16px — four of these languages are conventionally
blue, and at that size four blues are one blue, while `PY` and `TS` are two
shapes at any size. And the band carries no text: at 16px a 67×87 page leaves the
band about four pixels tall, so anything written inside it is under three pixels
and reads as a smudge.

## Regenerating

```sh
node assets/file-icons/generate.mjs
```

It rewrites `BADGE_ART`, `PAGE_SHELL`, `STROKE_ART` and `FAMILIES` in
`lib/client.js` and touches nothing else — the prose and the drawing functions
around them stay where they are read. Running it twice is a no-op, and it exits
non-zero after printing what it found wrong, so it can gate a commit.

It checks the claims the code makes rather than just transforming files:

- no `id`, `url(#…)` reference or gradient survives, which is what makes one
  element safe to render many times over
- the page and band geometry the code shares really is this set's, taken from
  `txt.svg` and confirmed present in each page-style badge
- every label is 1–4 safe capitals and every colour is `#RRGGBB`, which is what
  keeps the composed markup free of anything a caller could inject
- no extension is claimed twice, and a code badge may only take one from the
  catch-all `code` family — taking one from a family the set designed would be a
  silent redesign
- every extension the manifest mapped still resolves, and still falls back to the
  same outline: a code badge may change the picture a row shows, never which
  family it belongs to

Nothing is transcribed by hand. 18 KB of path data copied by eye is 18 KB of
chances to corrupt a curve, and a corrupted curve looks like a design choice —
which is exactly what happened once here, when a pass that stripped `id`
attributes also stripped `x` and `y`, collapsed every text label into the
top-left corner, and left badges that still drew a plausible blank page.

## Licence

The Lucide outlines are ISC; the licence text is in `LUCIDE-LICENSE.txt` and
covers their geometry wherever it appears, including the generated constants in
`lib/client.js`. The badges and the family table are the icon set author's own
work, used here with permission, and carry this package's MIT licence.
