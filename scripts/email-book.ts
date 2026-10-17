/* Builds a review book of every automated email: a summary table, then each
   email as the customer sees it, with its words in English, Greek and Russian.

     npx tsx scripts/email-book.ts out.html
   then print the HTML to PDF (scripts/email-book-pdf.mjs does it with Playwright).

   Uses the built-in words. Any text changed in Admin, Marketing & Emails is
   not included (that lives in the database). */

import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BRAND } from '../src/config/brand'
import { escapeHtml, render, sampleVars, TEMPLATES, delayLabel, wordsFor, type Locale, type TemplateDef } from '../src/lib/email-templates'

const out = process.argv[2] ?? 'email-book.html'
const site = 'https://aionix.example'
const assets = pathToFileURL(path.resolve('public')).href

const FOOT: Record<Locale, { why: string; unsub: string; life: string }> = {
  en: { why: 'You’re receiving this because you agreed to hear from AIONIX.', unsub: 'Unsubscribe', life: 'You’re receiving this because of your AIONIX account.' },
  el: { why: 'Λαμβάνεις αυτό το email επειδή συμφώνησες να λαμβάνεις νέα από το AIONIX.', unsub: 'Διαγραφή', life: 'Λαμβάνεις αυτό το email λόγω του λογαριασμού σου στο AIONIX.' },
  ru: { why: 'Вы получили это письмо, потому что согласились получать новости AIONIX.', unsub: 'Отписаться', life: 'Вы получили это письмо в связи с вашим аккаунтом AIONIX.' },
}

function renderOne(def: TemplateDef, locale: Locale) {
  const f = FOOT[def.internal ? 'en' : locale]
  const footer =
    def.category === 'marketing'
      ? { text: `${f.why}\n${f.unsub}: ${site}/${locale}/newsletter/unsubscribe`, html: `<br>${escapeHtml(f.why)} <a href="#" style="color:#6b6b6b">${escapeHtml(f.unsub)}</a>` }
      : def.category === 'lifecycle'
        ? { text: f.life, html: `<br>${escapeHtml(f.life)}` }
        : undefined
  const vars = {
    shop_url: `${site}/${locale}`,
    contact_url: `${site}/${locale}/contact`,
    sign_in_url: `${site}/${locale}/sign-in`,
    bag_url: `${site}/${locale}/cart`,
    ...sampleVars(def),
  }
  return render(def, wordsFor(def, locale, null), vars, { siteBase: assets, footer })
}

const who = (d: TemplateDef) => (d.internal ? `Staff (${BRAND.contact.email})` : 'Customer')
const kind = (d: TemplateDef) => (d.internal ? 'Staff alert' : d.category === 'essential' ? 'Essential' : d.category === 'lifecycle' ? 'Account' : 'Marketing')
const delay = (d: TemplateDef) => {
  if (!d.timing) return 'At once'
  return delayLabel(d.timing.minutes)
}
const order = ['essential', 'lifecycle', 'marketing']
const list = [...TEMPLATES].sort((a, b) => Number(!!a.internal) - Number(!!b.internal) || order.indexOf(a.category) - order.indexOf(b.category))

const rows = list
  .map(
    (d, i) => `<tr>
  <td class="n">${i + 1}</td>
  <td><a href="#${d.key}"><b>${escapeHtml(d.name)}</b></a><div class="sub">${escapeHtml(wordsFor(d, 'en', null).subject.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, '[$1]'))}</div></td>
  <td>${escapeHtml(who(d))}</td>
  <td><span class="tag t-${kind(d).split(' ')[0].toLowerCase()}">${kind(d)}</span></td>
  <td>${escapeHtml(d.trigger)}</td>
  <td>${escapeHtml(delay(d))}</td>
  <td>${d.required ? 'No, always sent' : d.defaultEnabled ? 'Yes, on now' : 'Yes, off now'}</td>
</tr>`,
  )
  .join('')

const bodyOf = (html: string) => /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
const LANG: Record<Locale, string> = { en: 'English', el: 'Greek', ru: 'Russian' }

const sections = list
  .map((d, i) => {
    const en = renderOne(d, 'en')
    const langs: Locale[] = d.internal ? ['en'] : ['en', 'el', 'ru']
    const texts = langs
      .map((l) => {
        const r = l === 'en' ? en : renderOne(d, l)
        return `<div class="lang"><h4>${LANG[l]}</h4><p class="subj"><span>Subject</span> ${escapeHtml(r.subject)}</p><pre>${escapeHtml(r.text.trim())}</pre></div>`
      })
      .join('')
    return `<section class="mail" id="${d.key}">
  <div class="head">
    <span class="num">${i + 1}</span>
    <div><h2>${escapeHtml(d.name)}</h2>
    <p class="meta"><b>Goes to</b> ${escapeHtml(who(d))} &nbsp;·&nbsp; <b>Type</b> ${kind(d)} &nbsp;·&nbsp; <b>Sent</b> ${escapeHtml(d.trigger)}${d.timing ? `, after ${escapeHtml(delay(d))}` : ''} &nbsp;·&nbsp; <b>Switch off</b> ${d.required ? 'not possible' : 'possible'}</p>
    ${d.note ? `<p class="note">${escapeHtml(d.note)}</p>` : ''}</div>
  </div>
  <h3>How it looks (English, sample details)</h3>
  <div class="preview">${bodyOf(en.html)}</div>
  <h3>The words</h3>
  ${texts}
</section>`
  })
  .join('')

const today = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())
const counts = {
  total: list.length,
  customer: list.filter((d) => !d.internal).length,
  staff: list.filter((d) => d.internal).length,
  always: list.filter((d) => d.required).length,
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>AIONIX automated emails</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, Segoe UI, Helvetica, Arial, sans-serif; color: #111; font-size: 11px; line-height: 1.45; margin: 0; }
  .cover { background: #0b0b0b; color: #fff; padding: 28px 30px; border-bottom: 5px solid #ffd43b; border-radius: 10px; }
  .cover img { height: 26px; }
  .cover h1 { font-size: 26px; margin: 18px 0 4px; letter-spacing: -.01em; }
  .cover p { margin: 0; color: #c9c9c9; font-size: 12px; }
  .stats { display: flex; gap: 10px; margin: 18px 0 6px; }
  .stat { flex: 1; border: 1px solid #e5e5e5; border-radius: 10px; padding: 10px 12px; }
  .stat b { display: block; font-size: 20px; }
  .stat span { color: #6b6b6b; }
  h2.sec { font-size: 15px; margin: 22px 0 8px; }
  table.sum { width: 100%; border-collapse: collapse; }
  table.sum th { text-align: left; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: #6b6b6b; border-bottom: 2px solid #111; padding: 6px 6px; }
  table.sum td { border-bottom: 1px solid #eee; padding: 6px; vertical-align: top; }
  table.sum tr { page-break-inside: avoid; }
  td.n { color: #6b6b6b; width: 18px; }
  .sub { color: #6b6b6b; font-size: 10px; margin-top: 2px; }
  a { color: #111; text-decoration: none; }
  .tag { display: inline-block; border-radius: 99px; padding: 1px 8px; font-size: 9.5px; font-weight: 600; white-space: nowrap; }
  .t-essential { background: #fff3c4; color: #7a5a00; }
  .t-account { background: #e3f1ff; color: #0b4f8a; }
  .t-marketing { background: #e9f8ee; color: #1b6b37; }
  .t-staff { background: #111; color: #ffd43b; }
  .info { margin-top: 14px; padding: 10px 12px; background: #f6f6f4; border-radius: 10px; color: #333; }
  .mail { page-break-before: always; }
  .head { display: flex; gap: 12px; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 12px; }
  .num { flex: none; width: 30px; height: 30px; border-radius: 99px; background: linear-gradient(135deg,#ffe58a,#ffd43b 48%,#f2b705); display: grid; place-items: center; font-weight: 700; }
  .head h2 { margin: 0 0 3px; font-size: 17px; }
  .meta { margin: 0; color: #444; }
  .note { margin: 4px 0 0; color: #7a5a00; }
  h3 { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #6b6b6b; margin: 14px 0 6px; }
  .preview { border: 1px solid #e5e5e5; border-radius: 10px; overflow: hidden; page-break-inside: avoid; }
  .preview > div { padding: 18px 16px !important; }
  .lang { border: 1px solid #eee; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; page-break-inside: avoid; }
  .lang h4 { margin: 0 0 6px; font-size: 11px; }
  .subj { margin: 0 0 6px; }
  .subj span { font-size: 9px; letter-spacing: .08em; text-transform: uppercase; color: #6b6b6b; margin-right: 6px; }
  pre { white-space: pre-wrap; font-family: inherit; margin: 0; color: #222; }
</style></head><body>
<div class="cover">
  <img src="${assets}/brand/aionix-logo.png" alt="AIONIX">
  <h1>Automated emails</h1>
  <p>Every email the shop sends by itself, to customers and to you. Prepared ${today}.</p>
</div>
<div class="stats">
  <div class="stat"><b>${counts.total}</b><span>automated emails</span></div>
  <div class="stat"><b>${counts.customer}</b><span>to customers, in EN, EL, RU</span></div>
  <div class="stat"><b>${counts.staff}</b><span>to staff</span></div>
  <div class="stat"><b>${counts.always}</b><span>always sent, cannot be switched off</span></div>
</div>
<h2 class="sec">Summary</h2>
<table class="sum"><thead><tr><th></th><th>Email and subject</th><th>Goes to</th><th>Type</th><th>When it is sent</th><th>Delay</th><th>Can be switched off</th></tr></thead><tbody>${rows}</tbody></table>
<div class="info">
  <b>Also sent, but written by you each time:</b> email campaigns (new arrivals or a promotion) from Marketing &amp; Emails, Email campaigns, and SMS campaigns. They are not automated, so they are not in this book.<br>
  <b>Samples:</b> names, products, prices, codes and links in this book are examples. Real emails use the customer's own details.<br>
  <b>Your edits:</b> this book shows the built-in words. Any text you changed in Marketing &amp; Emails replaces it.
</div>
${sections}
</body></html>`

writeFileSync(out, html)
console.log(`wrote ${out}: ${list.length} emails`)
