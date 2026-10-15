/* ============================================================================
 * Listing filters, over real HTTP — the URL is the state.
 *
 *     npm run check:filters      (needs the site running: npm run dev)
 *
 * Against the demo catalogue, proves that:
 *   · a filtered URL renders the filtered products on the server — so it
 *     survives a refresh and can be shared — with the filters shown chosen;
 *   · the live count (/api/products/count) matches the page for the same URL;
 *   · the groups combine: OR within, AND between, size/colour/stock on the
 *     same variant;
 *   · the page offers only sizes and colours that exist, and a department
 *     page does not offer departments;
 *   · junk in the URL is ignored, not an error.
 * ========================================================================== */

import './load-env'

const BASE = process.env.CHECK_BASE ?? 'http://localhost:3100'

let failures = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) {
    failures++
    if (detail !== undefined) console.log('       ', JSON.stringify(detail)?.slice(0, 300))
  }
}

async function page(path: string) {
  const res = await fetch(BASE + path, { redirect: 'manual' })
  const html = await res.text()
  const count = Number(/(\d+) products?</.exec(html)?.[1] ?? NaN)
  return { status: res.status, html, count }
}

async function apiCount(ctx: string, qs: string) {
  const res = await fetch(`${BASE}/api/products/count?ctx=${ctx}&locale=en&${qs}`)
  const body = (await res.json()) as { total?: number }
  return { status: res.status, total: body.total }
}

async function main() {
  try {
    await fetch(BASE + '/en', { redirect: 'manual' })
  } catch {
    console.error(`\n✗ nothing is answering on ${BASE}.\n  Start the site first:  npm run dev\n`)
    process.exitCode = 1
    return
  }

  console.log('\nThe URL is the state')
  const all = await page('/en/sports-nutrition')
  const m = await page('/en/sports-nutrition?size=1kg')
  const mBlack = await page('/en/sports-nutrition?size=1kg&colour=chocolate')
  check('a department page renders its products', all.status === 200 && all.count > 0, all.count)
  check('size=1kg narrows it, on the server', m.count > 0 && m.count <= all.count, [all.count, m.count])
  check('and 1kg is shown chosen (so a refresh or a shared link keeps it)', /aria-pressed="true"[^>]*>1kg</.test(m.html))
  check('size=1kg&colour=chocolate narrows it further (groups are AND)', mBlack.count <= m.count, [m.count, mBlack.count])
  check('the chosen filters appear as removable chips', /aria-label="Remove 1kg"/.test(mBlack.html) && /aria-label="Remove Chocolate"/.test(mBlack.html))

  console.log('\nWithin a group: OR')
  const s = await page('/en/sports-nutrition?size=300g')
  const xl = await page('/en/sports-nutrition?size=2kg')
  const both = await page('/en/sports-nutrition?size=300g,2kg')
  check('300g or 2kg shows at least as many as either', both.count >= Math.max(s.count, xl.count), [s.count, xl.count, both.count])

  console.log('\nThe live count agrees with the page')
  for (const [ctx, path, qs] of [
    ['sports-nutrition', '/en/sports-nutrition', 'size=1kg&colour=chocolate'],
    ['health-wellness', '/en/health-wellness', 'minPrice=15&maxPrice=30&inStock=1'],
    ['new', '/en/new', 'department=sports-nutrition&sale=1'],
    ['sports-nutrition/protein', '/en/sports-nutrition/protein', 'colour=chocolate'],
  ] as const) {
    const [p, c] = await Promise.all([page(`${path}?${qs}`), apiCount(ctx, qs)])
    check(`${ctx} ?${qs}: page ${p.count} = count ${c.total}`, p.count === c.total, [p.count, c.total])
  }
  const bad = await apiCount('..%2Fadmin', 'size=1kg')
  check('an invalid context is refused (422)', bad.status === 422, bad.status)

  console.log('\nPrice uses what the customer pays')
  const hoodie = await page('/en/sports-nutrition?minPrice=33&maxPrice=34')
  check('the promoted whey isolate (€39.90 → €33.91) is inside €33 to €34', /Whey Protein Isolate/.test(hoodie.html), hoodie.count)
  const cheap = await page('/en/sports-nutrition?maxPrice=33')
  check('and outside "up to €33"', !/Whey Protein Isolate/.test(cheap.html))

  console.log('\nOnly options that make sense')
  check('a department page has no Range group', !/aria-label="Range"/.test(all.html))
  const leggings = await page('/en/sports-nutrition/protein')
  check('a subcategory page has no Category group', !/>Category</.test(leggings.html))
  const sale = await page('/en/sale')
  const switches = (html: string) => (html.match(/role="switch"/g) ?? []).length
  check('the Sale page has no "On sale" switch', switches(sale.html) === 1 && switches(all.html) === 2, [switches(sale.html), switches(all.html)])
  const newIn = await page('/en/new')
  check('a page spanning departments offers them', /aria-label="Range"/.test(newIn.html))
  check('sizes that do not exist are not offered', !/>XXXL</.test(all.html))

  console.log('\nJunk in the URL')
  const junk = await page(`/en/sports-nutrition?size=%3Cscript%3Ealert(1)%3C%2Fscript%3E&colour=';drop&minPrice=-5&maxPrice=abc&sort=evil&page=-2`)
  check('is ignored — the page renders, unfiltered', junk.status === 200 && junk.count === all.count, [junk.status, junk.count])
  check('and nothing typed is echoed back as markup', !junk.html.includes('<script>alert(1)'))

  console.log(failures ? `\n✗ ${failures} check(s) failed\n` : '\n✓ listing filters behave correctly over HTTP\n')
  if (failures) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
