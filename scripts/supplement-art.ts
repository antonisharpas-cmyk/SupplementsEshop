/* ============================================================================
 * Supplement packshots.
 *
 * Draws each product as the pack it actually comes in: a protein tub, a
 * creatine jar, a pouch, a capsule bottle, a bar, a shaker. Every pack wears
 * the AIONIX look (black body, yellow stripe, the "A" mark) with a band in the
 * flavour's own colour, on a dark studio backdrop that matches the site.
 *
 * This is scaffolding until real photographs arrive. `npm run art` writes these
 * only where no photograph exists (see scripts/generate-art.ts), so dropping
 * `<slug>.jpg` into public/products replaces a drawing with no code change.
 *
 * Vector, so the whole catalogue weighs less than one photograph.
 * ========================================================================== */

export type PackKind = 'tub' | 'jar' | 'pouch' | 'bottle' | 'bar' | 'shaker' | 'stack'

export type View = 'front' | 'back'

export type PackLabel = {
  /** Big words on the pack, one or two short lines. */
  title: string[]
  /** Small line under the title, e.g. the flavour. */
  sub?: string
  /** Pack size, e.g. "2KG" or "90 CAPS". */
  size?: string
}

const W = 900
const H = 1200

const YELLOW = '#FFE600'
const BLACK = '#0B0B0B'
const CHARCOAL = '#1A1A1A'
const GRAPHITE = '#2E2E2E'
const SILVER = '#A7A7A7'
const LIGHT = '#E6E6E6'

const FONT = `font-family="'Arial Black','Helvetica Neue',Arial,sans-serif"`

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* ---------------------------------------------------------- backdrop --- */

function backdrop(tone: string, bare = false) {
  return `
  <defs>
    <radialGradient id="bg" cx="0.5" cy="0.38" r="0.75">
      <stop offset="0" stop-color="#262626"/>
      <stop offset="0.55" stop-color="#141414"/>
      <stop offset="1" stop-color="${BLACK}"/>
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${tone}" stop-opacity=".30"/>
      <stop offset="1" stop-color="${tone}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#000" stop-opacity=".85"/>
      <stop offset="1" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#050505"/>
      <stop offset="0.18" stop-color="#2a2a2a"/>
      <stop offset="0.32" stop-color="#151515"/>
      <stop offset="0.8" stop-color="#0d0d0d"/>
      <stop offset="1" stop-color="#030303"/>
    </linearGradient>
    <linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4f4f4"/>
      <stop offset="0.5" stop-color="#9a9a9a"/>
      <stop offset="1" stop-color="#e0e0e0"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.2" stop-color="#fff" stop-opacity=".10"/>
      <stop offset="0.28" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  ${
    bare
      ? ''
      : `<rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="${W / 2}" cy="${H * 0.45}" rx="430" ry="430" fill="url(#glow)"/>
  <g stroke="${GRAPHITE}" stroke-width="1.5" opacity=".6">
    <path d="M0 ${H * 0.86} L${W} ${H * 0.86}"/>
  </g>`
  }`
}

function floorShadow(cx: number, y: number, w: number) {
  return `<ellipse cx="${cx}" cy="${y}" rx="${w * 0.62}" ry="26" fill="url(#shadow)"/>`
}

/* The "A" mark, simplified: a silver chevron with a yellow arch beneath. */
function mark(cx: number, cy: number, s: number) {
  const k = s / 100
  return `<g transform="translate(${cx - 50 * k} ${cy - 30 * k}) scale(${k})">
    <path d="M22 44 L48 6 Q50 3 52 6 L82 50 L74 52 L50 18 L30 46 Z" fill="url(#silver)"/>
    <path d="M2 62 Q44 26 66 40 Q76 46 96 64 L88 64 Q72 50 62 46 Q44 38 12 62 Z" fill="${YELLOW}"/>
  </g>`
}

function wordmark(cx: number, y: number, size: number, fill = '#fff') {
  return `<text x="${cx}" y="${y}" text-anchor="middle" ${FONT} font-weight="900" font-size="${size}" letter-spacing="${size * 0.18}" fill="${fill}">AIONIX</text>`
}

function titleLines(lines: string[], cx: number, y: number, size: number, fill = '#fff') {
  return lines
    .map(
      (l, i) =>
        `<text x="${cx}" y="${y + i * size * 1.02}" text-anchor="middle" ${FONT} font-weight="900" font-size="${size}" letter-spacing="1" fill="${fill}">${esc(l.toUpperCase())}</text>`,
    )
    .join('')
}

/* Fit a title into a width by shrinking the font for long lines. */
function fitSize(lines: string[], width: number, max: number) {
  const longest = Math.max(...lines.map((l) => l.length), 1)
  return Math.min(max, Math.floor((width / longest) * 1.55))
}

/* The front label, shared by every container: mark, wordmark, title, a
   flavour band and the pack size. */
function frontLabel(cx: number, top: number, width: number, label: PackLabel, tone: string, scale = 1) {
  const size = fitSize(label.title, width * 0.86, 64 * scale)
  const titleY = top + 122 * scale + size * 0.95
  const bandY = titleY + label.title.length * size * 1.02 + 6 * scale
  return `
    ${mark(cx, top + 52 * scale, 74 * scale)}
    ${wordmark(cx, top + 108 * scale, 26 * scale)}
    <rect x="${cx - width / 2}" y="${top + 122 * scale}" width="${width}" height="${6 * scale}" fill="${YELLOW}"/>
    ${titleLines(label.title, cx, titleY, size)}
    ${
      label.sub
        ? `<rect x="${cx - width / 2}" y="${bandY}" width="${width}" height="${42 * scale}" fill="${tone}"/>
           <text x="${cx}" y="${bandY + 29 * scale}" text-anchor="middle" ${FONT} font-weight="900" font-size="${22 * scale}" letter-spacing="3" fill="${isLight(tone) ? BLACK : '#fff'}">${esc(label.sub.toUpperCase())}</text>`
        : ''
    }
    ${
      label.size
        ? `<text x="${cx}" y="${bandY + (label.sub ? 88 : 40) * scale}" text-anchor="middle" ${FONT} font-weight="900" font-size="${28 * scale}" letter-spacing="2" fill="${YELLOW}">${esc(label.size)}</text>`
        : ''
    }`
}

/* The back label: a nutrition panel and directions, as text blocks. */
function backLabel(cx: number, top: number, width: number, label: PackLabel, scale = 1) {
  const x = cx - width / 2
  const rows = [
    ['Energy', '■■■ kcal'],
    ['Protein', '■■ g'],
    ['Carbohydrate', '■ g'],
    ['of which sugars', '■ g'],
    ['Fat', '■ g'],
    ['Salt', '■ g'],
  ]
  const rowH = 30 * scale
  return `
    ${wordmark(cx, top + 40 * scale, 24 * scale)}
    <rect x="${x}" y="${top + 56 * scale}" width="${width}" height="${5 * scale}" fill="${YELLOW}"/>
    <text x="${x}" y="${top + 98 * scale}" ${FONT} font-weight="900" font-size="${20 * scale}" fill="#fff">NUTRITION INFORMATION</text>
    <rect x="${x}" y="${top + 112 * scale}" width="${width}" height="${rows.length * rowH + 14 * scale}" fill="none" stroke="${SILVER}" stroke-width="2"/>
    ${rows
      .map(
        ([k, v], i) => `
      <text x="${x + 14 * scale}" y="${top + 136 * scale + i * rowH}" font-family="Arial,sans-serif" font-size="${17 * scale}" fill="${LIGHT}">${k}</text>
      <text x="${x + width - 14 * scale}" y="${top + 136 * scale + i * rowH}" text-anchor="end" font-family="Arial,sans-serif" font-size="${17 * scale}" fill="${SILVER}">${v}</text>
      ${i < rows.length - 1 ? `<path d="M${x + 10 * scale} ${top + 144 * scale + i * rowH} H${x + width - 10 * scale}" stroke="${GRAPHITE}" stroke-width="1.5"/>` : ''}`,
      )
      .join('')}
    <text x="${x}" y="${top + 160 * scale + rows.length * rowH}" ${FONT} font-weight="900" font-size="${17 * scale}" fill="${YELLOW}">DIRECTIONS</text>
    ${[0, 1, 2]
      .map(
        (i) =>
          `<rect x="${x}" y="${top + 176 * scale + rows.length * rowH + i * 20 * scale}" width="${width * (i === 2 ? 0.6 : 1)}" height="${8 * scale}" rx="4" fill="${GRAPHITE}"/>`,
      )
      .join('')}
    ${label.size ? `<text x="${cx}" y="${top + 268 * scale + rows.length * rowH}" text-anchor="middle" ${FONT} font-weight="900" font-size="${22 * scale}" fill="${SILVER}">${esc(label.size)}</text>` : ''}`
}

/* ------------------------------------------------------------- colour --- */

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function isLight(hex: string) {
  const [r, g, b] = parse(hex)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150
}

/* -------------------------------------------------------- containers --- */

function tub(label: PackLabel, tone: string, view: View, big = true) {
  const w = big ? 520 : 420
  const h = big ? 600 : 470
  const cx = W / 2
  const bottom = H * 0.86
  const top = bottom - h
  const lidH = big ? 92 : 80
  const lidTop = top - lidH + 10
  const ridges = Array.from({ length: 22 }, (_, i) => {
    const x = cx - w / 2 - 6 + ((w + 12) / 22) * (i + 0.5)
    return `<path d="M${x} ${lidTop + 12} V${lidTop + lidH - 12}" stroke="#000" stroke-opacity=".55" stroke-width="3"/>`
  }).join('')
  const s = big ? 1 : 0.82
  return `
    ${floorShadow(cx, bottom + 4, w)}
    <rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" rx="34" fill="url(#body)"/>
    <rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" rx="34" fill="url(#sheen)"/>
    <rect x="${cx - w / 2 - 8}" y="${lidTop}" width="${w + 16}" height="${lidH}" rx="18" fill="#141414"/>
    ${ridges}
    <rect x="${cx - w / 2 - 8}" y="${lidTop}" width="${w + 16}" height="10" rx="5" fill="#2c2c2c"/>
    <rect x="${cx - w / 2}" y="${top + 14}" width="${w}" height="8" fill="${YELLOW}"/>
    ${
      view === 'front'
        ? frontLabel(cx, top + 40, w - 70, label, tone, s)
        : backLabel(cx, top + 40, w - 110, label, s)
    }
    <rect x="${cx - w / 2}" y="${bottom - 30}" width="${w}" height="8" fill="${tone}"/>`
}

function pouch(label: PackLabel, tone: string, view: View) {
  const cx = W / 2
  const bottom = H * 0.86
  const w = 540
  const h = 760
  const top = bottom - h
  return `
    ${floorShadow(cx, bottom + 4, w)}
    <path d="M${cx - w / 2 + 10} ${top} H${cx + w / 2 - 10} L${cx + w / 2} ${bottom - 40} Q${cx + w / 2} ${bottom} ${cx + w / 2 - 40} ${bottom} H${cx - w / 2 + 40} Q${cx - w / 2} ${bottom} ${cx - w / 2} ${bottom - 40} Z" fill="url(#body)"/>
    <path d="M${cx - w / 2 + 10} ${top} H${cx + w / 2 - 10} V${top + 54} H${cx - w / 2 + 8} Z" fill="#161616"/>
    ${Array.from({ length: 30 }, (_, i) => `<path d="M${cx - w / 2 + 14 + i * 17.6} ${top} v14" stroke="#000" stroke-width="3"/>`).join('')}
    <rect x="${cx - w / 2 + 6}" y="${top + 62}" width="${w - 12}" height="8" fill="${YELLOW}"/>
    <circle cx="${cx}" cy="${top + 30}" r="9" fill="${BLACK}" stroke="#333" stroke-width="3"/>
    ${
      view === 'front'
        ? frontLabel(cx, top + 100, w - 90, label, tone, 1.05)
        : backLabel(cx, top + 110, w - 130, label, 1.05)
    }
    <rect x="${cx - w / 2 + 2}" y="${bottom - 46}" width="${w - 4}" height="10" fill="${tone}"/>`
}

function bottle(label: PackLabel, tone: string, view: View) {
  const cx = W / 2
  const bottom = H * 0.86
  const w = 360
  const h = 520
  const top = bottom - h
  return `
    ${floorShadow(cx, bottom + 4, w)}
    <rect x="${cx - 110}" y="${top - 120}" width="220" height="110" rx="14" fill="#151515"/>
    ${Array.from({ length: 14 }, (_, i) => `<path d="M${cx - 100 + i * 15.4} ${top - 108} V${top - 24}" stroke="#000" stroke-width="3" opacity=".6"/>`).join('')}
    <rect x="${cx - 120}" y="${top - 24}" width="240" height="40" rx="10" fill="#0f0f0f"/>
    <rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" rx="60" fill="url(#body)"/>
    <rect x="${cx - w / 2}" y="${top}" width="${w}" height="${h}" rx="60" fill="url(#sheen)"/>
    <rect x="${cx - w / 2}" y="${top + 70}" width="${w}" height="${h - 130}" fill="${CHARCOAL}"/>
    <rect x="${cx - w / 2}" y="${top + 70}" width="${w}" height="6" fill="${YELLOW}"/>
    ${
      view === 'front'
        ? frontLabel(cx, top + 82, w - 50, label, tone, 0.78)
        : backLabel(cx, top + 82, w - 70, label, 0.72)
    }
    <rect x="${cx - w / 2}" y="${top + h - 66}" width="${w}" height="6" fill="${tone}"/>`
}

function bar(label: PackLabel, tone: string, view: View) {
  const cx = W / 2
  const cy = H * 0.55
  const w = 700
  const h = 230
  const bars = [
    { dy: -170, rot: -8, op: 0.55 },
    { dy: 0, rot: -4, op: 1 },
  ]
  const one = (dy: number, rot: number, op: number, main: boolean) => `
    <g transform="rotate(${rot} ${cx} ${cy + dy})" opacity="${op}">
      <path d="M${cx - w / 2} ${cy + dy - h / 2} h${w} l-6 12 l6 12 l-6 12 l6 12 V${cy + dy + h / 2} h-${w} l6 -12 l-6 -12 l6 -12 l-6 -12 Z" fill="url(#body)"/>
      <rect x="${cx - w / 2 + 40}" y="${cy + dy - h / 2}" width="16" height="${h}" fill="${YELLOW}"/>
      <rect x="${cx + w / 2 - 150}" y="${cy + dy - h / 2}" width="110" height="${h}" fill="${tone}"/>
      ${
        main && view === 'front'
          ? `${mark(cx - w / 2 + 140, cy + dy - 30, 70)}
             ${wordmark(cx - w / 2 + 140, cy + dy + 50, 22)}
             ${titleLines(label.title, cx + 40, cy + dy - (label.title.length - 1) * 24 + 6, Math.min(46, fitSize(label.title, 300, 46)))}
             ${label.sub ? `<text x="${cx + 40}" y="${cy + dy + 78}" text-anchor="middle" ${FONT} font-size="20" letter-spacing="3" fill="${YELLOW}">${esc(label.sub.toUpperCase())}</text>` : ''}`
          : main
            ? `${wordmark(cx - 40, cy + dy - 40, 24)}
               <text x="${cx - 40}" y="${cy + dy + 10}" text-anchor="middle" ${FONT} font-size="20" fill="${LIGHT}">NUTRITION INFORMATION</text>
               ${[0, 1, 2].map((i) => `<rect x="${cx - 220}" y="${cy + dy + 32 + i * 22}" width="${i === 2 ? 240 : 360}" height="9" rx="4" fill="${GRAPHITE}"/>`).join('')}`
            : ''
      }
    </g>`
  return `
    ${floorShadow(cx, H * 0.78, w)}
    ${bars.map((b, i) => one(b.dy, b.rot, b.op, i === bars.length - 1)).join('')}
    ${label.size ? `<text x="${cx}" y="${H * 0.86 + 70}" text-anchor="middle" ${FONT} font-size="34" letter-spacing="4" fill="${YELLOW}">${esc(label.size)}</text>` : ''}`
}

function shaker(label: PackLabel, tone: string, view: View) {
  const cx = W / 2
  const bottom = H * 0.86
  const topW = 380
  const botW = 330
  const h = 600
  const top = bottom - h
  return `
    ${floorShadow(cx, bottom + 4, topW)}
    <path d="M${cx - topW / 2} ${top} H${cx + topW / 2} L${cx + botW / 2} ${bottom - 20} Q${cx + botW / 2} ${bottom} ${cx + botW / 2 - 20} ${bottom} H${cx - botW / 2 + 20} Q${cx - botW / 2} ${bottom} ${cx - botW / 2} ${bottom - 20} Z" fill="${tone}" fill-opacity=".92"/>
    <path d="M${cx - topW / 2} ${top} H${cx + topW / 2} L${cx + botW / 2} ${bottom - 20} Q${cx + botW / 2} ${bottom} ${cx + botW / 2 - 20} ${bottom} H${cx - botW / 2 + 20} Q${cx - botW / 2} ${bottom} ${cx - botW / 2} ${bottom - 20} Z" fill="url(#sheen)"/>
    ${[100, 200, 300, 400, 500].map((m, i) => `<path d="M${cx + topW / 2 - 20 - i * 5} ${bottom - 60 - i * 96} h-36" stroke="#000" stroke-opacity=".5" stroke-width="3"/><text x="${cx + topW / 2 - 66 - i * 5}" y="${bottom - 54 - i * 96}" text-anchor="end" font-family="Arial" font-size="18" fill="#000" fill-opacity=".55">${m}</text>`).join('')}
    <rect x="${cx - topW / 2 - 10}" y="${top - 120}" width="${topW + 20}" height="130" rx="22" fill="#121212"/>
    <rect x="${cx - topW / 2 - 10}" y="${top - 12}" width="${topW + 20}" height="10" fill="${YELLOW}"/>
    <path d="M${cx - 60} ${top - 120} V${top - 170} Q${cx - 60} ${top - 190} ${cx - 40} ${top - 190} H${cx + 40} Q${cx + 60} ${top - 190} ${cx + 60} ${top - 170} V${top - 120}" fill="#121212"/>
    <path d="M${cx + 130} ${top - 120} Q${cx + 230} ${top - 230} ${cx + 210} ${top - 60}" fill="none" stroke="#121212" stroke-width="22" stroke-linecap="round"/>
    ${view === 'front' ? `${mark(cx, top + 170, 120)}${wordmark(cx, top + 270, 44, BLACK)}${label.sub ? `<text x="${cx}" y="${top + 316}" text-anchor="middle" ${FONT} font-size="22" letter-spacing="4" fill="${BLACK}">${esc(label.sub.toUpperCase())}</text>` : ''}` : `${wordmark(cx, top + 220, 44, BLACK)}`}
    ${label.size ? `<text x="${cx}" y="${bottom + 70}" text-anchor="middle" ${FONT} font-size="30" letter-spacing="4" fill="${YELLOW}">${esc(label.size)}</text>` : ''}`
}

/* Several products together, for category tiles. */
function stack(label: PackLabel, tone: string) {
  return `
    <g transform="translate(-150 60) scale(.72)" opacity=".75">${tub({ title: [] }, tone, 'back', false)}</g>
    <g transform="translate(400 120) scale(.62)" opacity=".75">${bottle({ title: [] }, tone, 'back')}</g>
    <g transform="translate(110 40) scale(.78)">${tub(label, tone, 'front')}</g>`
}

/* ------------------------------------------------------------ public --- */

export function packSvg(
  kind: PackKind,
  label: PackLabel,
  colors: [string, string],
  view: View,
  /** No studio backdrop, for placing the pack inside a bigger picture. */
  bare = false,
): string {
  const [tone] = colors
  const body =
    kind === 'tub'
      ? tub(label, tone, view, true)
      : kind === 'jar'
        ? tub(label, tone, view, false)
        : kind === 'pouch'
          ? pouch(label, tone, view)
          : kind === 'bottle'
            ? bottle(label, tone, view)
            : kind === 'bar'
              ? bar(label, tone, view)
              : kind === 'shaker'
                ? shaker(label, tone, view)
                : stack(label, tone)
  /* Packs are drawn at a comfortable size, then scaled up about the floor
     line so the product fills the 3:4 frame the shop's cards use. */
  const zoom = kind === 'shaker' ? 1.12 : kind === 'stack' ? 1 : kind === 'bar' ? 1.12 : 1.27
  const fy = H * 0.86
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${backdrop(tone, bare)}<g transform="translate(${W / 2} ${fy}) scale(${zoom}) translate(${-W / 2} ${-fy})">${body}</g></svg>`
}

/** A category tile: one representative pack and the category name. */
export function tileSvg(kind: PackKind, label: PackLabel, colors: [string, string]): string {
  return packSvg(kind, label, colors, 'front')
}
