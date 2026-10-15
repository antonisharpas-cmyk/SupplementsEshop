/* ============================================================================
 * Spreadsheet files for the accountant: CSV and a real Excel .xlsx.
 *
 * The .xlsx is written by hand (it is a zip of a few XML files) rather than
 * pulling in a spreadsheet library: the shop only ever needs plain sheets of
 * text, numbers, money and dates, and this keeps the server bundle small.
 * Money cells are real numbers with a money format, dates are real dates, so
 * the accountant can sum, filter and pivot straight away.
 * ========================================================================== */

import { deflateRawSync } from 'node:zlib'

export type Cell = string | number | Date | null | undefined
export type Column = { header: string; kind?: 'text' | 'money' | 'int' | 'date' | 'percent'; width?: number }
export type Sheet = { name: string; columns: Column[]; rows: Cell[][] }

/* ----------------------------------------------------------------- CSV -- */

const cyprusTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Nicosia',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

function csvCell(v: Cell, kind?: Column['kind']): string {
  if (v === null || v === undefined) return ''
  const s =
    v instanceof Date
      ? cyprusTime.format(v)
      : typeof v === 'number' && kind === 'money'
        ? v.toFixed(2)
        : String(v)
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** UTF-8 with a byte order mark, so Excel opens Greek and Russian names
 *  correctly when the file is double clicked. */
export function toCsv(sheet: Sheet): string {
  const lines = [sheet.columns.map((c) => csvCell(c.header)).join(',')]
  for (const r of sheet.rows) lines.push(r.map((v, i) => csvCell(v, sheet.columns[i]?.kind)).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/* ---------------------------------------------------------------- XLSX -- */

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

function colName(i: number) {
  let n = i + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/* Style indexes, matching styles.xml below. */
const STYLE = { text: 0, header: 1, money: 2, date: 3, int: 4, percent: 5 } as const

function excelDate(d: Date) {
  /* Excel counts days from 1899-12-30, in wall clock time: Cyprus time. */
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Nicosia',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, Number(x.value)]),
  )
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wall / 86_400_000 + 25_569
}

function sheetXml(sheet: Sheet) {
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? (c.kind === 'money' ? 13 : c.kind === 'date' ? 18 : 16)}" customWidth="1"/>`)
    .join('')
  const head =
    `<row r="1">` +
    sheet.columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="${STYLE.header}"><is><t>${esc(c.header)}</t></is></c>`).join('') +
    `</row>`
  const body = sheet.rows
    .map((row, ri) => {
      const r = ri + 2
      const cells = row
        .map((v, ci) => {
          if (v === null || v === undefined || v === '') return ''
          const ref = `${colName(ci)}${r}`
          const kind = sheet.columns[ci]?.kind ?? 'text'
          if (v instanceof Date) return `<c r="${ref}" s="${STYLE.date}"><v>${excelDate(v)}</v></c>`
          if (typeof v === 'number' && Number.isFinite(v)) {
            const s = kind === 'money' ? STYLE.money : kind === 'percent' ? STYLE.percent : kind === 'int' ? STYLE.int : STYLE.text
            return `<c r="${ref}" s="${s}"><v>${v}</v></c>`
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
        })
        .join('')
      return `<row r="${r}">${cells}</row>`
    })
    .join('')
  const last = `${colName(Math.max(0, sheet.columns.length - 1))}${sheet.rows.length + 1}`
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${head}${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    `</worksheet>`
  )
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFFFE27A"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="6">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`

export function toXlsx(sheets: Sheet[]): Buffer {
  const names = sheets.map((s, i) => esc(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`))
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        `</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `<definedNames>${sheets
          .map((s, i) =>
            `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i]}'!$A$1:$${colName(Math.max(0, s.columns.length - 1))}$${s.rows.length + 1}</definedName>`,
          )
          .join('')}</definedNames>` +
        `</workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)] as [string, string]),
  ]
  return zip(files.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })))
}

/* ----------------------------------------------------------------- zip -- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  /* A fixed timestamp (2026-01-01): file dates inside are irrelevant here. */
  const dosTime = 0
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const packed = deflateRawSync(e.data)
    const crc = crc32(e.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(dosTime, 10)
    local.writeUInt16LE(dosDate, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, packed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(dosTime, 12)
    central.writeUInt16LE(dosDate, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + packed.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}
