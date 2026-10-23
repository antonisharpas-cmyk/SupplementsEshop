/* ============================================================================
 * Reading a table the owner gives us: an Excel .xlsx file, a CSV, or rows
 * copied from Excel and pasted into a box (they arrive tab separated).
 *
 * The .xlsx is read by hand, like it is written in lib/spreadsheet.ts: it is
 * a zip of XML files and we only need the first sheet's cell values. Returns
 * rows of trimmed strings; numbers are left as text for the caller to parse.
 * ========================================================================== */

import { inflateRawSync } from 'node:zlib'

export type Rows = string[][]

/* ------------------------------------------------------------- the zip -- */

function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  /* The end of central directory record sits in the last 64 KB. */
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('Not a zip file.')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localAt = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const lName = buf.readUInt16LE(localAt + 26)
    const lExtra = buf.readUInt16LE(localAt + 28)
    const start = localAt + 30 + lName + lExtra
    const data = buf.subarray(start, start + size)
    if (/\.(xml|rels)$/.test(name)) out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data))
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')

/** All the text runs inside one <si> or <is>, joined. */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('')

function colIndex(ref: string) {
  const letters = ref.replace(/\d+/g, '')
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function readXlsx(buf: Buffer): Rows {
  const files = unzip(buf)
  const shared = [...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
  /* The first sheet in the workbook's order. */
  const sheetName =
    [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0] ??
    null
  if (!sheetName) throw new Error('That Excel file has no sheet.')
  const xml = files.get(sheetName)!.toString('utf8')
  const rows: Rows = []
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = []
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const body = c[2] ?? ''
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
      const type = attrs.match(/\bt="(\w+)"/)?.[1]
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = textOf(body)
      else if (v !== undefined) value = decode(v)
      const at = ref ? colIndex(ref) : cells.length
      while (cells.length < at) cells.push('')
      cells[at] = value.trim()
    }
    rows.push(cells)
  }
  return rows
}

/* ---------------------------------------------------------- text tables -- */

/** CSV (comma or semicolon) or tab separated text, with quoted fields. */
export function readDelimited(text: string): Rows {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const firstLine = clean.split('\n', 1)[0] ?? ''
  const sep = firstLine.includes('\t') ? '\t' : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: Rows = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n') {
      row.push(cell.trim())
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell.trim())
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c !== ''))
}

/** A file from an upload: .xlsx by its zip signature, otherwise text. */
export function readTable(buf: Buffer): Rows {
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf).filter((r) => r.some((c) => c !== ''))
  return readDelimited(buf.toString('utf8'))
}

/**
 * A money or quantity cell as a number: "12,50", "€ 1.234,50", "1,234.50",
 * "15" all work. Returns NaN when there is no number.
 */
export function parseNumber(raw: string | undefined): number {
  if (raw === undefined) return NaN
  let s = raw.replace(/[€$£\s ]/g, '')
  if (!s) return NaN
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Find the columns by their header words, so the owner's own sheet works as
 * long as it has recognisable headers. Falls back to positions.
 */
export function pickColumns<K extends string>(
  header: string[],
  wanted: Record<K, string[]>,
  fallback: Record<K, number>,
): { cols: Record<K, number>; hasHeader: boolean } {
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z0-9α-ωа-я]/gi, ''))
  const cols = {} as Record<K, number>
  let found = 0
  for (const key of Object.keys(wanted) as K[]) {
    const idx = norm.findIndex((h) => wanted[key].some((w) => h === w || h.startsWith(w)))
    if (idx >= 0) {
      cols[key] = idx
      found++
    } else cols[key] = -1
  }
  if (found === 0) return { cols: fallback, hasHeader: false }
  for (const key of Object.keys(wanted) as K[]) if (cols[key] < 0) cols[key] = fallback[key] ?? -1
  return { cols, hasHeader: true }
}
