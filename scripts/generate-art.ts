/* ============================================================================
 * Writes the product artwork into public/products/ (front and back for each
 * product in the catalogue, plus the category tiles) and the homepage hero
 * into public/hero/.
 *
 *     npm run art
 *
 * IT NEVER OVERWRITES A PHOTOGRAPH. Drop `whey-protein-isolate.jpg` into
 * public/products/ and that photograph wins from then on: this script skips the
 * slug, and the seed prefers the photo. That is the upgrade path: the shop
 * copies its own photography into one folder, and nothing in the code changes.
 * ========================================================================== */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CATALOGUE_ART, CATEGORY_TILES, PHOTO_EXTENSIONS, artDir, heroDir } from './art-manifest'
import { packSvg, tileSvg } from './supplement-art'

function hasPhotograph(dir: string, slug: string): string | null {
  for (const ext of PHOTO_EXTENSIONS) {
    if (existsSync(join(dir, `${slug}${ext}`))) return `${slug}${ext}`
  }
  return null
}

/* Strip the outer <svg> so a pack can be placed inside a bigger picture. */
function inner(svg: string, x: number, y: number, w: number) {
  const h = (w * 1200) / 900
  return svg.replace(
    /^<svg [^>]*>/,
    `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 900 1200">`,
  )
}

/* The hero: packs on the right, room for the headline on the left. No text in
   the artwork, because the headline is real DOM laid over it. */
function heroSvg(width: number, height: number, mobile: boolean) {
  const [a, b, c] = [CATALOGUE_ART[0], CATALOGUE_ART[5], CATALOGUE_ART[1]]
  const packs = mobile
    ? [
        inner(packSvg(c.kind, c.label, c.colors, 'front', true), -60, 60, 520),
        inner(packSvg(b.kind, b.label, b.colors, 'front', true), 360, 120, 480),
        inner(packSvg(a.kind, a.label, a.colors, 'front', true), 120, 10, 580),
      ]
    : [
        inner(packSvg(c.kind, c.label, c.colors, 'front', true), 820, 170, 520),
        inner(packSvg(b.kind, b.label, b.colors, 'front', true), 1150, 240, 470),
        inner(packSvg(a.kind, a.label, a.colors, 'front', true), 950, 120, 600),
      ]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <radialGradient id="hbg" cx="${mobile ? 0.5 : 0.72}" cy="0.4" r="0.8">
      <stop offset="0" stop-color="#2a2a2a"/><stop offset="0.6" stop-color="#121212"/><stop offset="1" stop-color="#0B0B0B"/>
    </radialGradient>
    <linearGradient id="streak" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FFE600" stop-opacity="0"/><stop offset="0.5" stop-color="#FFE600" stop-opacity=".55"/><stop offset="1" stop-color="#FFE600" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#hbg)"/>
  <g opacity=".9">
    <path d="M${width * 0.1} ${height * 0.95} L${width * 1.05} ${height * 0.28}" stroke="url(#streak)" stroke-width="10"/>
    <path d="M${width * 0.2} ${height * 1.02} L${width * 1.05} ${height * 0.42}" stroke="url(#streak)" stroke-width="3"/>
  </g>
  <g opacity=".08" transform="translate(${mobile ? 40 : width * 0.45} ${mobile ? 120 : 40}) scale(${mobile ? 7 : 9})">
    <path d="M22 44 L48 6 Q50 3 52 6 L82 50 L74 52 L50 18 L30 46 Z" fill="#fff"/>
    <path d="M2 62 Q44 26 66 40 Q76 46 96 64 L88 64 Q72 50 62 46 Q44 38 12 62 Z" fill="#FFE600"/>
  </g>
  <g>${packs.join('')}</g>
</svg>`
}

function main() {
  const dir = artDir()
  mkdirSync(dir, { recursive: true })

  let drawn = 0
  let skipped = 0

  for (const item of CATALOGUE_ART) {
    const photo = hasPhotograph(dir, item.slug)
    if (photo) {
      console.log(`  · ${item.slug}: keeping ${photo}`)
      skipped++
      continue
    }

    writeFileSync(join(dir, `${item.slug}.svg`), packSvg(item.kind, item.label, item.colors, 'front'))
    writeFileSync(join(dir, `${item.slug}-back.svg`), packSvg(item.kind, item.label, item.colors, 'back'))
    drawn++
  }

  for (const tile of CATEGORY_TILES) {
    const name = `category-${tile.key}`
    if (hasPhotograph(dir, name)) {
      skipped++
      continue
    }
    writeFileSync(join(dir, `${name}.svg`), tileSvg(tile.kind, tile.label, tile.colors))
    drawn++
  }

  const hero = heroDir()
  mkdirSync(hero, { recursive: true })
  if (!hasPhotograph(hero, 'hero')) writeFileSync(join(hero, 'hero.svg'), heroSvg(1600, 1000, false))
  if (!hasPhotograph(hero, 'hero-mobile'))
    writeFileSync(join(hero, 'hero-mobile.svg'), heroSvg(800, 1200, true))

  const total = readdirSync(dir).length
  console.log(`\n✓ ${drawn} drawn, ${skipped} left alone, ${total} files in public/products\n`)
  console.log('  To use real photography, put <slug>.jpg in that folder and run')
  console.log('  npm run art && npm run db:seed, and the photo is used instead.\n')
}

main()
