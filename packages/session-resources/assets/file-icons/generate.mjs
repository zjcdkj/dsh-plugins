#!/usr/bin/env node
/**
 * Rewrite the icon data in `lib/client.js` from the sources in this directory.
 *
 *     node assets/file-icons/generate.mjs
 *
 * Four literals are generated and nothing else: `BADGE_ART`, `PAGE_SHELL`,
 * `STROKE_ART` and `FAMILIES`. The prose and the drawing functions around them
 * stay in `client.js`, where they are read; a generator that emitted its own
 * comments would be a second copy of them to keep in step.
 *
 * `CODE_BADGES` travels the other way — this reads it back OUT of `client.js`.
 * Which languages get a badge, and in what colour, is a design decision, so it
 * belongs beside the code that draws it. This only derives from it.
 *
 * Nothing is transcribed by hand. 18 KB of path data copied by eye is 18 KB of
 * chances to corrupt a curve, and a corrupted curve looks like a design choice.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', '..', 'lib', 'client.js')
const warnings = []

/**
 * Extensions the manifest predates. It was written for a document app; a coding
 * session's ledger sees these constantly. Kept here rather than edited into the
 * manifest so that file stays the icon set's own record.
 */
const EXTRA = {
  code: ['pl', 'r', 'rake', 'gradle'],
  excel: ['xlsm', 'tsv', 'parquet'],
  data: ['jsonc', 'json5', 'ndjson', 'cfg', 'conf', 'env', 'properties', 'lock'],
  image: ['avif'],
  markdown: ['mdx'],
  text: ['tex'],
  archive: ['tgz', 'zst'],
}

/** Most entries any one family may claim before the table gets unreadable. */
const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'))
const source = readFileSync(CLIENT, 'utf8')
const eol = source.includes('\r\n') ? '\r\n' : '\n'

/** Locate one top-level literal by its declaration and its closing bracket. */
function locate(text, name, close) {
  const lines = text.split(/\r?\n/)
  const open = lines.findIndex(line => line.startsWith(`    const ${name} = `))
  if (open < 0) throw new Error(`${name}: declaration not found in client.js`)
  const end = lines.findIndex((line, index) => index > open && line === `    ${close}`)
  if (end < 0) throw new Error(`${name}: closing "${close}" not found after line ${open + 1}`)
  return { open, end, lines }
}

/** Evaluate one literal out of client.js, for the table this only reads. */
function readLiteral(name, close) {
  const at = locate(source, name, close)
  const body = at.lines.slice(at.open, at.end + 1).join('\n').replace(`const ${name} =`, 'return')
  return new Function(body)()
}

const CODE_BADGES = readLiteral('CODE_BADGES', ']')

/**
 * Strip an exported SVG to reusable inner markup plus its viewBox.
 *
 * Only comments and identifiers come out. Everything else is geometry or
 * typesetting: `x`/`y` place a label and the ruled lines, `class` and `style` can
 * carry a fill. An earlier pass stripped those along with the root element's own
 * `x`/`y`, which silently collapsed every text label into the top-left corner —
 * the badges still drew a page, so it read as a design choice rather than a bug.
 * Ids go because one element is rendered many times over and duplicate ids are
 * invalid; the checks here are what make that safe.
 * @param {string} label - the file, for warnings.
 * @param {string} raw - the file's contents.
 * @returns {{ viewBox: string, inner: string } | null} parsed art, or null.
 */
function extract(label, raw) {
  const viewBox = /viewBox="([^"]+)"/.exec(raw)?.[1]
  const open = /<svg\b[^>]*>/.exec(raw)
  const close = raw.lastIndexOf('</svg>')
  if (viewBox === undefined || open === null || close < 0) {
    warnings.push(`${label}: could not parse`)
    return null
  }
  let inner = raw.slice(open.index + open[0].length, close)
  const refs = [...inner.matchAll(/url\(#([^)]*)\)/g)].map(match => match[1])
  const defs = [...inner.matchAll(/<(linearGradient|radialGradient|clipPath|mask|filter)\b/g)].map(match => match[1])
  if (refs.length || defs.length) {
    warnings.push(`${label}: refs=[${refs}] defs=[${defs}] — ids are shared across instances`)
  }
  const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(inner)
  if (style !== null && style[1].trim() !== '') {
    warnings.push(`${label}: non-empty <style> — dropping ids would break its selectors`)
  }
  inner = inner
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<defs>\s*<style[^>]*>\s*<\/style>\s*<\/defs>/g, '')
    .replace(/\s(?:id|p-id)="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim()
  return { viewBox, inner }
}

const quote = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
const read = file => readFileSync(join(HERE, file), 'utf8')

// --- badges: the set's own multicolour artwork ---------------------------

const badges = new Map()
for (const asset of manifest.active_file_type_assets) {
  const parsed = extract(asset.file, read(asset.packaged_as))
  if (parsed !== null) badges.set(asset.file, parsed)
}

// --- the page shell the set's own document badges share ------------------

const txt = badges.get('txt.svg')?.inner ?? ''
const shell = {
  page: /<path fill="#E6E6DD" d="([^"]+)"\/>/.exec(txt)?.[1],
  corner: /<polygon fill="#D6D3C6" points="([^"]+)"\/>/.exec(txt)?.[1],
  band: /<path fill="#646A73" d="(M64[^"]+)"\/>/.exec(txt)?.[1],
}
for (const [part, value] of Object.entries(shell)) {
  if (value === undefined) warnings.push(`page shell: could not read "${part}" out of txt.svg`)
}
/* The claim the code makes is that this geometry is the set's, not invented. */
for (const [file, art] of badges) {
  if (art.inner.includes(shell.page ?? '\u0000') !== art.inner.includes(shell.band ?? '\u0000')) {
    warnings.push(`${file}: page and band geometry disagree with txt.svg`)
  }
}
const pageStyle = [...badges].filter(([, art]) => art.inner.includes(shell.page ?? '\u0000')).map(([file]) => file)

// --- strokes: only the fallbacks some family names ----------------------

const wanted = new Set(manifest.file_type_families.map(family => family.fallback).filter(Boolean))
wanted.add('File') // the generic, for a name with no recognized format
wanted.add('FileCode') // the fallback every code badge shares
const lucide = new Map(manifest.lucide_exports.map(entry => [entry.name, entry.packaged_as]))
const strokes = new Map()
for (const name of [...wanted].sort()) {
  const file = lucide.get(name)
  if (file === undefined) {
    warnings.push(`fallback "${name}" is named by a family but absent from lucide_exports`)
    continue
  }
  const parsed = extract(file, read(file))
  if (parsed === null) continue
  if (parsed.viewBox !== '0 0 24 24') warnings.push(`${name}: unexpected viewBox ${parsed.viewBox}`)
  strokes.set(name, parsed.inner)
}

// --- code badges: validated, then subtracted from the manifest's families -

const byBadge = new Map()
for (const badge of CODE_BADGES) {
  if (!/^[A-Z][A-Z+#]{0,3}$/.test(badge.label)) {
    warnings.push(`${badge.name}: label "${badge.label}" is not 1-4 safe capitals`)
  }
  if (!/^#[0-9A-F]{6}$/.test(badge.colour)) {
    warnings.push(`${badge.name}: colour "${badge.colour}" is not #RRGGBB`)
  }
  for (const ext of badge.ext ?? []) {
    if (byBadge.has(ext)) warnings.push(`extension "${ext}" claimed by code badges ${byBadge.get(ext)} and ${badge.name}`)
    else byBadge.set(ext, badge.name)
  }
}
/* Taking an extension from a family the set designed would be a silent redesign,
 * so only the catch-all `code` family may lose any. */
for (const family of manifest.file_type_families) {
  if (family.key === 'code') continue
  const taken = family.extensions.filter(ext => byBadge.has(ext))
  if (taken.length) warnings.push(`code badges would take ${taken.join(', ')} from family "${family.key}"`)
}

// --- families: the manifest's, plus the two supplements ------------------

const familyLines = []
const claimed = new Map()
const strokeOf = new Map()
const addFamily = (key, badge, stroke, ext) => {
  for (const one of ext) {
    if (claimed.has(one)) warnings.push(`extension "${one}" claimed by both ${claimed.get(one)} and ${key}`)
    else { claimed.set(one, key); strokeOf.set(one, stroke) }
  }
  familyLines.push(
    `      { key: ${quote(key)}, ${badge === null ? '' : `badge: ${quote(badge)}, `}stroke: ${quote(stroke)},`
    + `${eol}        ext: [${ext.map(quote).join(', ')}] },`,
  )
}

for (const family of manifest.file_type_families) {
  const ext = [...new Set([...family.extensions, ...(EXTRA[family.key] ?? [])])].filter(one => !byBadge.has(one))
  if (family.asset !== null && !badges.has(family.asset)) {
    warnings.push(`${family.key}: asset ${family.asset} is not among the active assets`)
  }
  if (!strokes.has(family.fallback)) warnings.push(`${family.key}: fallback ${family.fallback} unavailable`)
  if (ext.length === 0) warnings.push(`${family.key}: every extension was taken by a code badge`)
  else addFamily(family.key, family.asset, family.fallback, ext)
}
/* `code:` marks a badge composed at load time rather than read from a file. */
for (const badge of CODE_BADGES) addFamily(`code-${badge.name}`, `code:${badge.name}`, 'FileCode', badge.ext ?? [])

/* Every extension the manifest mapped must still resolve, and still fall back to
 * the same glyph — a code badge may change the picture a row shows, never which
 * family it belongs to. */
for (const family of manifest.file_type_families) {
  for (const ext of family.extensions) {
    if (!claimed.has(ext)) warnings.push(`manifest extension "${ext}" (${family.key}) is no longer mapped`)
    else if (strokeOf.get(ext) !== family.fallback) {
      warnings.push(`extension "${ext}": fallback changed ${family.fallback} -> ${strokeOf.get(ext)}`)
    }
  }
}

// --- splice the four literals back into client.js ------------------------

const blocks = {
  BADGE_ART: [...badges].map(([file, art]) =>
    `      ${quote(file)}: { box: ${quote(art.viewBox)}, art: ${quote(art.inner)} },`),
  PAGE_SHELL: [
    `      page: ${quote(shell.page ?? '')},`,
    `      corner: ${quote(shell.corner ?? '')},`,
    `      band: ${quote(shell.band ?? '')},`,
  ],
  STROKE_ART: [...strokes].map(([name, art]) => `      ${name}: ${quote(art)},`),
  FAMILIES: familyLines,
}

let output = source
for (const [name, lines] of Object.entries(blocks)) {
  const close = name === 'FAMILIES' ? ']' : '}'
  const at = locate(output, name, close)
  const next = [
    at.lines[at.open],
    ...lines.join('\n').split('\n'),
    at.lines[at.end],
  ]
  output = [...at.lines.slice(0, at.open), ...next, ...at.lines.slice(at.end + 1)].join(eol)
}

if (warnings.length) {
  console.error(`${warnings.length} warning(s):`)
  for (const warning of warnings) console.error(`  ${warning}`)
}
if (output === source) {
  console.log('client.js already matches these sources; nothing written.')
} else {
  writeFileSync(CLIENT, output, 'utf8')
  console.log(`client.js rewritten: ${source.length} -> ${output.length} bytes`)
}
console.log(`badges ${badges.size} (page-style: ${pageStyle.join(' ')})`)
console.log(`code badges ${CODE_BADGES.length} over ${byBadge.size} extensions`)
console.log(`strokes ${strokes.size}: ${[...strokes.keys()].join(' ')}`)
console.log(`families ${familyLines.length}, extensions mapped ${claimed.size}`)
process.exitCode = warnings.length === 0 ? 0 : 1
