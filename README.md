# AIONIX Supplement Store

The AIONIX online supplement shop (protein, creatine, pre workout, vitamins and
more): Next.js 16 (App Router) + TypeScript + Tailwind, PostgreSQL via Drizzle,
three languages (EN / EL / RU). Built on the same platform as the Fitness
Maniacs clothing store, re-themed with the AIONIX palette and logo.

**What changed from the clothing store**

| | |
| --- | --- |
| Brand | `src/config/brand.ts` (name, palette, logo paths). Logo files in `public/brand/`. |
| Palette | Dark theme from the AIONIX brand colours, as tokens in `src/app/globals.css`: `#0B0B0B` background, `#1A1A1A` cards, `#2E2E2E` borders, `#A7A7A7` secondary text, `#E6E6E6` text, `#FFFFFF` headings, `#FFE600` buttons and highlights. |
| Catalogue | Two ranges, Sports Nutrition and Health & Wellness, ten sections, sixteen placeholder products (`scripts/seed.ts`). |
| Variants | A product's **size** is its pack size (`1kg`, `2kg`, `300g`, `90 caps`), each with its own price where it differs. **Colour** is used as the **flavour** (shown as "Flavour" everywhere). Sizes sort by weight, so `300g` comes before `1kg` (`src/lib/sizes.ts`). |
| Product page | Flavour chips, each pack size shows its price, the chosen price is repeated above the button, and "Size guide" became "Nutrition & usage". |
| Images | `npm run art` draws AIONIX branded packshots (tub, jar, pouch, bottle, bar, shaker) and the hero (`scripts/supplement-art.ts`). Real photos replace them; see IMAGES.md. |

Everything that has been built, and what has not, is in **[OVERVIEW.md](OVERVIEW.md)**.

Running the shop day to day — signing in as an admin, stock, prices, settings —
is in **[ADMIN.md](ADMIN.md)**. The photographs the shop is waiting for, and
exactly what to name them, are in **[IMAGES.md](IMAGES.md)**.

Brand name, address and legal details live in **`src/config/brand.ts`**. The
company details, address, email and phone are still `TODO` placeholders: fill
them in before launch.

## Running it

A fresh clone runs with no configuration: the committed `.env.development`
already points at the embedded PostgreSQL that ships in `node_modules`, so
there is no dotfile to write by hand before anything works.

```bash
npm install
npm run dev                       # http://localhost:3100
```

That is the whole thing. `npm run dev` checks whether anything is listening
where `DATABASE_URL` points; if nothing is, it starts the embedded PostgreSQL
itself, applies the schema and seeds the catalogue on the first run, and then
starts Next. Ctrl+C stops both. Nothing to keep open in a second window, and no
order to remember.

The individual steps are still there when you want them:

```bash
npm run db:local                  # just the database, in its own terminal
npm run db:check                  # configuration → connection → schema → data
npm run db:push                   # schema + CHECK constraints + indexes
npm run db:seed                   # 12 categories, 16 products, 36 variants
npm run dev:next                  # just Next, against a database you started
```

If port 3100 is taken: `$env:PORT=3200; npm run dev` on PowerShell,
`PORT=3200 npm run dev` elsewhere.

To use a PostgreSQL of your own instead — an installed one, Render, Neon —
create `.env.local` and put its `DATABASE_URL` there. `.env.local` is ignored by
git and overrides every value in `.env.development`, which is only ever loaded
in development and holds nothing secret.

`db:local` is real PostgreSQL 18 compiled to WebAssembly (PGlite), speaking the
normal wire protocol on a TCP port — the application cannot tell the difference
and needs no changes. Its one limit is that queries are serialised through a
single engine, so set `DATABASE_POOL_MAX=1` and do not use it to judge the
concurrency behaviour; the reservation tests want a real server. Its data lives
in `./.localdb`.

When `db:check` says the database is ready and `npm run dev` still misbehaves,
the problem is the app, not the setup — that is the point of the check.

The seed prints its logins. It also deliberately includes a sold out flavour,
a sold out product, nearly sold out sizes, a manual sale price, an active
category promotion (15% off protein) and two promo codes (one expired), every
state the UI has to handle.

## Verifying it

```bash
npm test          # 223 unit/integration tests against a real Postgres
npm run check     # ~225 checks against a running dev server, over HTTP
npm run lint
npm run build
```

One unit test is skipped on the embedded development database (`npm run db:local`),
which runs a single engine and would deadlock rather than race — see
`src/db/engine.ts`. It runs against an installed PostgreSQL.

`npm test` needs a **separate** database — `.env.test.local` with a
`DATABASE_URL` pointing at e.g. `storefront_test`. The tests truncate tables, so
pointing them at the dev database wipes your seed data.

The HTTP checks are the ones worth reading:

| Script | What it proves |
| --- | --- |
| `check:concurrency` | Two — then ten — visitors race for the last unit. Exactly one wins, the losers get a readable 409, nothing is ever oversold. |
| `check:promo` | A promo code is validated, priced and stored server-side; a forged discount in the request body is ignored; refusals explain themselves. |
| `check:views` | Views are counted per person (a refresh does not inflate them), and nobody can read anyone else's history. |
| `check:auth` | No account exists until the emailed code is verified; the two passwords must match (checked by the server too); a registered email gets the same answer as a new one plus an "existing account" email, and no second account can be made; duplicate phone refused; the welcome email is scheduled on verification; a wrong password and an unknown address are indistinguishable; the guest bag follows the customer into their account — including the last item in stock. |
| `check:admin` | A stranger and a signed-in customer are both turned away from every admin page and every admin API, and their write attempts change nothing; an admin gets in; stock cannot be set below what live carts hold; a settings change reaches the storefront on the next request; *Sold out* and *Hidden* stop a purchase even through the API. |
| `check:filters` | A filtered URL renders the filtered products on the server (so it survives refresh and sharing); `/api/products/count` agrees with the page for the same URL; OR within a group, AND between; price is what the customer pays; a page offers only options that make sense there; junk in the URL is ignored. |
| `check:service` | Customer Service: one guest cannot read or write another's conversation even with its id; replies carry no staff identity; closing sends one transcript; the inbox is closed to non-admins; a guest must give name and email and gets the automatic first reply. Marketing & Emails: closed to non-admins; required emails cannot be switched off; unknown variables refused; a test email goes only to the configured test address; typed HTML stays text. Newsletter: no consent, no sign-up; a repeat sign-up gets the same answer; confirm and unsubscribe only by signed link, including a mail client's one-click unsubscribe. |

`npm run db:check` is the one to reach for first when something will not start:
it walks configuration → connection → schema → data and stops at the first
broken link with the fix, and prints no password, so its output is safe to
share.

## The parts that carry the design decisions

| File | Why it matters |
| --- | --- |
| `src/lib/inventory.ts` | Reservations. One transaction, `SELECT … FOR UPDATE` in a deterministic order, `available = on_hand - reserved` as a generated column. Stock cannot go negative, and an abandoned cart releases its hold inline rather than waiting for a sweep job. |
| `src/db/constraints.sql` | 25 CHECK constraints the ORM cannot express, including the ones that make overselling impossible at the database level, plus order-total consistency. |
| `src/lib/pricing.ts` | The single source of truth for money. A manual sale price and a promotion never stack; a promo code applies after product discounts and never to delivery; VAT is extracted from a VAT-inclusive gross. |
| `src/lib/auth/otp.ts` | Registration OTP. An unverified signup creates no user at all, and the attempt counter is committed before the rejection is thrown. |
| `src/lib/db-errors.ts` | Unwraps driver errors so a unique-violation is identified by constraint name rather than by substring-matching a message. |
| `src/lib/sizes.ts` | Pack sizes sort by weight (300g, 500g, 1kg, 2kg), counts by number, never alphabetically. Every list of sizes goes through it. |
| `public/products/` | Product imagery. `npm run art` draws each product as its real pack (tub, pouch, capsule bottle, bar, shaker) in AIONIX colours and **never overwrites a photograph**: drop `<slug>.jpg` in here, re-run `npm run art && npm run db:seed`, and the photo is used instead. |
| `src/components/ProductMarquee.tsx` | The moving strip on the homepage. The list is rendered twice and the track travels exactly half its width, so the loop is seamless; one CSS animation, no per-frame JavaScript. Pauses on hover and on keyboard focus, and does not animate at all under `prefers-reduced-motion`. |
| `src/lib/listing-filters.ts` | The listing URL ⇄ filters, used by the server page and the browser alike, so both read `?size=1kg&colour=chocolate&minPrice=20` the same way. No imports; prices in whole euros. |
| `src/lib/catalog.ts` → `buildListing` | Filters as named groups: OR within a group, AND between, and size/colour/stock checked on the same variant. Facets list what exists on the page, each counted with every other group applied. |
| `src/lib/pricing.ts` → `effectivePriceSql` | `resolvePrices` restated as SQL, so filtering and sorting by price use the number on the card; a test compares the two across product, category and fixed promotions. |
| `src/lib/admin-catalog.ts` | The admin Products and Stock lists. Every search, filter and sort runs in PostgreSQL with bound parameters, and only one page comes back. *Status* (the owner's choice: available / sold out / hidden) and *stock* (what the shelf says) are kept as separate questions. |
| `src/lib/support.ts` | Customer Service. Ownership by account or by a hashed http-only cookie token; conversations created only by a first message; the inactivity close measured from the last message; one `UPDATE … WHERE status = 'OPEN'` deciding who closed it, so the transcript is sent exactly once. |
| `src/lib/newsletter.ts` | The mailing list. Double opt-in with HMAC-signed links (`JWT_SECRET`), a consent ledger, answers that never reveal who is subscribed, List-Unsubscribe headers, and one mailing at a time behind an advisory lock. |
| `src/lib/email-templates.ts` | Every email's words (EN/EL/RU), its category, whether it is required, its timing and the variables it may use. Rendering is pure: values are escaped, unknown `{{…}}` are dropped, a paragraph whose variables are empty is left out, no code ever runs. |
| `src/lib/mailer.ts` | `sendTemplate(key, …)`: the owner's edits over the built-in words, the recipient's language with English fallback, the right footer, and a refusal to send marketing without an unsubscribe link. Required templates cannot be switched off. |
| `src/lib/automations.ts` | The event system. Every automated email is an `email_jobs` row (the event log) with its reason; the worker claims due jobs with `FOR UPDATE SKIP LOCKED` and re-checks consent, the frequency limit, purchases and availability at send time. Dedupe keys make each order email happen once. New triggers are a handler and a template. |
| `src/instrumentation.ts` | Starts the 30-second automation tick (idle chats, due emails, scheduled campaigns) when the server starts (Node runtime only). `POST /api/cron/automations` with `CRON_SECRET` does the same on hosts without a long-running process. |
| `src/i18n/messages.ts` | All UI copy, with plural forms selected by `Intl.PluralRules` — Greek "1 προϊόν", Russian one/few/many. |

## Where it stands

Built and verified: catalogue, navigation from the database, listing with SQL
filtering/sorting/facets, search (full-text + trigram, all three languages),
product pages with Product JSON-LD, cart with atomic stock reservation, promo
codes, promotions, product views feeding "most viewed" and "recently viewed",
localisation and locale negotiation.

Registration with email verification, sign-in, sign-out and a basic account
page are built and verified; so are the admin panel (overview, homepage,
products with search and filters, per-variant stock, sold-out / hidden status,
settings), Customer Service chat with its admin inbox and emails, and the
double opt-in newsletter, and Marketing & Emails (editable automated emails in
three languages, abandoned-bag reminders, scheduled campaigns, email activity
and the event log; order emails are wired and wait for checkout). Still to
come: Stripe checkout and webhooks, orders and order tracking, then the
SEO/performance/security passes. `OVERVIEW.md` has the full list.

### Environment variables added with Customer Service and the newsletter

| Variable | Needed | What for |
| --- | --- | --- |
| `JWT_SECRET` | in production | signs newsletter confirm/unsubscribe links; 16+ characters |
| `PUBLIC_SITE_URL` | in production | absolute links in emails (confirm, unsubscribe, the admin link) |
| `EMAIL_API_KEY`, `EMAIL_FROM` | to send real email | without them every email goes to the server log and `email_log` |
| `CRON_SECRET` | optional | enables `POST /api/cron/automations` (and the older `support-sweep`) for serverless hosts |
| `AUTOMATIONS=off` | optional | turns off the built-in 30-second automation tick (when cron does it); `SUPPORT_SWEEP=off` still works |
