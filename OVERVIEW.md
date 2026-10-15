# What has been built

The AIONIX supplement shop for Cyprus in three languages (English, Greek and Russian),
with a customer storefront, an admin panel for the owner, and a set of things
that happen by themselves so the shop runs without someone watching it.

This is the complete list, including what is **not** built yet, so nothing is
assumed.

---

## At a glance

| | |
|---|---|
| Catalogue | 16 products, 36 flavour and size variants, 2 ranges (Sports Nutrition, Health & Wellness), 10 categories |
| Languages | English, Greek, Russian — every screen, and every product name and description |
| Customer pages | Homepage, department, category, product, search, new arrivals, sale, bag, register, sign in, account, help & contact, newsletter, privacy |
| Admin screens | Overview, Homepage, Products, one product, Stock, Customer service, Newsletter, Settings |
| Database | 35 tables, with stock, money, consent and conversation rules enforced by the database itself |
| Checked | about 225 automatic checks against the running site, plus 223 unit tests |
| Runs on your laptop with | `npm run dev` — nothing to install besides `npm install` |

---

## 1. What a customer can do

### Browse

- **Homepage** — a full-width looping video with the headline over it; below
  it, *Shop by category* tiles, a *Moving fast* strip of products that scrolls
  on its own (pauses when you point at it), *Just dropped* (the newest pieces,
  with **Shop new arrivals**), a **Be first to know** newsletter sign-up, and
  *On sale*. The order and contents are set by you in the admin panel. At the
  bottom: delivery, returns, the store, and **Questions? Talk to us** — which
  opens the chat.
- **Promotion strip** — when a promotion is running, a red bar under the video
  says so ("15% OFF ALL PROTEIN, Shop now") and links to the right category.
- **Sports Nutrition / Health & Wellness pages, each category, New arrivals, Sale and search** —
  product grids with a filter panel that applies as you choose, without
  reloading the page:
  - **Category** (the department's subcategories, with counts) — and on
    pages that cover both, **Range** (All / Sports Nutrition / Health & Wellness) with its
    categories grouped beneath. A page never offers what it already is:
    `/sports-nutrition` has no range choice, a subcategory has no category list.
  - **Size** chips and **Colour** swatches (with names; a chosen colour gets a
    ring *and* a tick). Several at once: *black or blue*. Only sizes and
    colours that exist on the page are shown; one that would give no results
    with your other choices is dimmed rather than removed, so the panel does
    not jump around.
  - **Price** — a two-handle slider over the page's real price range (e.g.
    €18–€119), with typed *Minimum* / *Maximum* boxes beneath. It filters by
    what the customer actually pays, promotions included.
  - **Availability** — *In stock* and *On sale* switches.
  - **Active filters** above the grid as chips (`Black ×` `M ×` `€40 – €90 ×`),
    each removable, with **Clear all**; the product count; **Sort by**.
  - Groups fold away (and say what is chosen inside: *M*, *Black*, *€40 – €90*).
  - Everything is in the address — `/en/sports-nutrition?size=1kg&colour=chocolate&minPrice=20`
    — so a filtered page survives refresh and back/forward and can be shared.
  - **On a phone**: one **Filter & sort** bar that stays under the header; it
    opens a drawer where you set several filters at once, with **Clear all**
    and **Show 12 results** (the number updates as you choose) always at the
    bottom.
  - Between groups the choices combine (*M* **and** *black* **and** *€50–€100*);
    size, colour and *In stock* apply to the same item — "M + Black + In stock"
    means a black M that is in stock.
  - **Pages** of results, and a helpful empty state that offers to remove
    one filter at a time.
- **Product cards** — photo, which changes to the second photo when you point
  at it; price; the sale price and crossed-out original when reduced; a
  "−25%" badge; the sizes, with sold-out ones struck through.
- **Search** — suggestions appear as you type. It finds whole words in all
  three languages, parts of words ("whe" finds whey), and products by
  their SKU code. *Misspellings are not caught yet — see* Not built yet.
- **Recently viewed** — a row of what *you* looked at, on product pages.
  Private to you; nobody can see another visitor's list.
- **New arrivals** (`/new`) and **Sale** (`/sale`) — the whole shop, newest
  first, and everything reduced right now. The newsletter emails link here.
- **Sold out** — a piece you mark sold out, or with no stock left, stays in
  its category and search with a quiet *Sold out* band across the photo; it
  is still clickable, so people can find it and ask about it.

### A product page

- Photos, name, price (with the sale price and saving if reduced).
- **Size picker** — sizes in the right order (XS, S, M, L, XL, XXL), sold-out
  sizes disabled, and "only 2 left" when a size is low.
- **Add to bag** — which *holds* the item for 10 minutes (see *Automations*).
- **Sold out** — the page still opens, with the photos and details; the size
  buttons and Add to bag are disabled, a short note says it is sold out, and
  **Ask Customer Service** opens the chat. (A "notify me when it's back"
  button can be added here later; the page is laid out for it.)
- Details, a size guide, delivery and returns information.
- Structured product data for Google (name, price, in stock or not), so search
  results can show them.

### The bag

- Change quantities or remove lines.
- **Promo code** box — the code is checked by the server and the reason is
  given in words when it does not apply ("spend €12 more to use this code",
  "this code has expired", "you have already used this code").
- **Free delivery progress bar** — "€18 away from free delivery", then
  "free delivery unlocked".
- **Delivery**: *Collect in store — Larnaca* (free) or *Home delivery*,
  anywhere in Cyprus, 2–4 working days (€5, free over €50).
- Totals: subtotal, discounts, delivery, and how much of the total is VAT.
  Prices are shown VAT-inclusive, as EU law requires.

### An account

- **Register**: name, email, phone, password **typed twice** (each with its
  own eye button to show it; a mismatch is caught at once, and again by the
  server), and a marketing opt-in. A six-digit code is emailed, and **no
  account exists until the code is entered** — so nobody can register with
  someone else's email.
- **The code screen**: six boxes — typing moves along, Backspace goes back,
  pasting (or the phone's "code from Mail") fills all six and submits, a
  countdown shows when the code expires, and "Send a new code" unlocks after
  its wait.
- **An email that already has an account** gets exactly the same screen —
  and the owner is emailed "you already have an account" instead of a code.
  No second account is possible, and the form never reveals who is registered.
- **Welcome to AIONIX** — once the code is accepted, a short welcome email
  with a *Shop now* button (no promotions).
- **Sign in / sign out** — with the eye button in the password field.
- **The bag follows you** — whatever you put in the bag before signing in is
  still there after, including the last item in stock.
- **Account page** — who you are, and sign out. (Orders, addresses and the
  wishlist arrive with checkout — see *Not built yet*.)

### Customer Service chat

- A **Customer service** button in the corner of every page (a round icon on
  a phone, placed so it never covers Add to bag or the checkout button). It
  opens a panel headed **AIONIX Customer Service** — real people answer; it
  is never called a bot or an assistant.
- **How can we help?** — a guest gives a **name and email** (no account
  needed; *Already have an account? Sign in* is offered). A signed-in
  customer is never asked — the account's details are used. Opening the
  panel creates nothing; a conversation starts with the first message.
- **An automatic first reply** arrives straight away: *"Hello! Thank you for
  contacting AIONIX Customer Service. Someone from our team will reply as
  soon as possible."* — in the customer's language; its words and on/off
  switch are in the admin.
- Replies appear in the panel within a few seconds, labelled *AIONIX
  Customer Service*, with "Seen" under your last message once staff have read
  it. A red dot on the button means a new reply while the panel was closed.
- A conversation **closes after 10 minutes without a message** (from either
  side — it is measured from the last message, not from when it started), or
  when staff close it. You then see that it ended (and, if it was the timer,
  that it closed because no one wrote for 10 minutes), the messages stay on
  screen, a copy is emailed, and *Start a new conversation* is offered.

### The header

- Desktop: **Logo · Shop (Sports Nutrition, Health & Wellness) · Search · Account · Bag**. Phone:
  **Logo · Search · Account · Bag · Menu**. Clean line icons, each with a
  spoken label.
- The **bag icon's count** changes the moment the server confirms an add,
  remove or quantity change.

### Newsletter — "Get new arrivals"

- **Get first access to new drops** — email, optional first name, and an
  unticked box to say yes. The header strip, the homepage, the footer and
  `/newsletter` all lead to it. Nothing pops up and nothing blocks the page.
- **Double opt-in**: a confirmation link is emailed, and nobody is on the list
  until they click it. Ticking "email me" at **registration** subscribes
  straight away, because the account's email was just proven by the code;
  leaving it unticked adds nothing.
- Every marketing email has an **unsubscribe** link, and mail apps' own
  Unsubscribe button works too. No login needed.

### Help & contact

- `/contact`: start a chat, email, phone, opening hours, the store, delivery,
  returns, and common questions — every number taken from Settings, so it
  cannot disagree with the checkout. `/privacy` explains what is collected
  (a draft to have checked before launch).

### Languages

- Every address starts with the language: `/en`, `/el`, `/ru`, switchable in
  the header.
- Greek and Russian grammar is handled properly — "1 προϊόν / 2 προϊόντα",
  Russian's three plural forms — not "1 products".

### On a phone

- A phone menu, a phone-shaped cut of the hero video that follows the runner,
  and touch-friendly sizes and buttons.

---

## 2. What the shop owner can do — the admin panel

At `/admin`. Not linked from the shop; you type the address. Only accounts
with the Admin or Super-admin role get in — anyone else sees an ordinary
"page not found", so the panel does not announce that it exists.

### Overview

Three blocks, in the order you ask them:

- **Today** — orders, revenue, new customers, open conversations. (Orders and
  revenue stay at zero until checkout exists; the screen says so.)
- **Inventory** — sizes sold out, sizes low, units held in bags, products live.
- **Needs attention** — customers waiting (unread first), the sizes to
  restock, and any email that failed to send in the last week.

### Homepage

Drag and drop:

- **The order of the page** — drag Shop by category, Moving fast, Just
  dropped, the newsletter sign-up and On sale into any order; a switch hides
  one without losing its contents.
- **Each section**: *Automatic* (the shop chooses — newest, most viewed,
  reduced) or *Hand-picked* (exactly your products or categories, in the order
  you drag them). Add from a picker with search; remove with ×.
- Rules that keep it honest: *On sale* refuses products that are not reduced,
  and one whose sale ends drops out by itself; hidden products never show;
  the moving strip needs at least three products.

### Products

- **Search** by name, SKU, category or product ID, as you type.
- **Filters** that combine: Department, Category, Status, Stock, Sale, Price
  range. Each choice shows as a chip you can remove; **Clear all filters**
  removes them all. The filtered view lives in the address, so it can be
  bookmarked or sent to a colleague.
- Each row: a small photo, name, category, SKU, price (sale price in red),
  units available, and status. The whole row opens the product. On a phone
  the rows become cards.
- **One product**, in sections (with a jump list): *Status*, *Pricing*,
  *Photos*, *Variants & stock*, *Details*.
  - **Status** — three choices: **Available**, **Sold out** (stays in the shop,
    marked, cannot be bought whatever the stock says) and **Hidden** (off the
    shop). None of them deletes anything; orders and stock stay as they are.
  - **Price** and **sale price** (must be lower than the price).
  - **Photos** — drag to reorder; the first is on every card, the second shows
    on hover.
  - **Variants & stock** — one line per colour and size, editable in place.

### Stock

- **One line per variant** — photo, product, colour (swatch and name), size,
  SKU, on the shelf, held, available, and the product's status when it is
  not simply available.
- **Quick views** with counts: *Needs attention* (low or out, on products
  customers can buy — the view it opens on when anything needs you), *All*,
  *Low stock*, *Sold out*, *In stock*.
- **Search** product, SKU, colour or size — "chocolate", "1kg", "whey", or
  "black xs" together. A size on its own means that size: "S" is small, not
  every name with an S in it.
- **Filters** for department, category, colour and size; **sorting** by
  attention, available, product, category, colour or size.
- **Edit in place**: click a number, type, **Enter** — it saves ("Saving…",
  then "Saved ✓") and moves to the next line. ↑/↓ move between lines, Escape
  puts a line back. You **cannot** set a size below what customers are
  holding in their bags; the line says so and shows the real number.

### Customer service

- An inbox: **Open**, **Closed** and **All** tabs, newest activity first,
  each with the customer's name and email, **Guest** or **Signed in**, the
  last message, how long ago, and an unread count. The nav shows how many
  are waiting.
- The automatic first reply is marked *automatic reply*, so you can tell it
  from a person's answer. **Automatic first reply** at the top of the page
  switches it on/off and edits it in English, Greek and Russian.
- Open one to read it and reply (Enter sends, Shift+Enter is a new line).
  The customer sees replies from *AIONIX Customer Service* — never which of
  you wrote them. **Close conversation** asks first, then emails the customer
  a copy. Nothing is ever deleted.
- The screen updates itself every few seconds, and each new conversation is
  also **emailed to you** (the address is in Settings).

### Marketing & Emails

Every email the shop sends, in one place — five tabs:

- **Automated emails** — a table of *Automation · Type · Trigger · Status ·
  Action*, grouped as **Essential** (codes, security, orders, transcripts —
  always on, marked *Required*), **Lifecycle** (welcome, back in stock,
  review request) and **Marketing** (abandoned bag and its follow-up).
  *Edit* opens one: the on/off switch (optional emails only), the timing
  (e.g. the bag reminder's 4 hours), and the subject, text and button in
  **English, Greek and Russian**. Words are plain text with `{{variables}}`
  — the list of what each email offers is beside the text, click to insert;
  a variable the email does not have is refused before saving. A **live
  preview** with sample values updates as you type, and **Send test email**
  sends it to the test address (and only there).
- **Campaigns** — new-arrivals or promotion mailings: subject, message,
  products (automatic, one category, or up to six picked by hand), the button
  and where it goes, a promotion code and "valid until", who (everyone, or
  one language) and **when** (now, or a date and time — cancellable until it
  starts). Nothing is mailed automatically when a product is added.
- **Subscribers** — confirmed, new in 30 days, waiting, unsubscribed, and the
  searchable list with consent dates.
- **Email activity** — every email: recipient, which email, subject, when it
  was triggered, scheduled and sent, its status (scheduled, sent, not sent,
  failed…) and **why** — e.g. *"1 item in the bag, last changed 14:00"* →
  *"Ordered 15:10 — no reminder needed"*.
- **Settings** — the test email address, and the **marketing frequency limit**
  (default: at most one marketing email per person per 20 hours).

The **Overview** now opens with **Customer activity**: new customers today,
open conversations, newsletter subscribers, abandoned bags, emails scheduled,
emails sent today.

### Settings — live immediately, no developer needed

| Setting | What it changes |
|---|---|
| Free delivery over | the threshold, and the progress bar in the bag |
| Hold stock in a bag for | how long an item stays reserved (1–60 minutes) |
| VAT rate | how the VAT part of a total is shown |
| Low stock warning at | when a size is flagged here and "only a few left" in the shop |
| Maximum per size in one order | stops one person clearing out a size |
| Delivery estimate | the days shown on product pages |
| Order number prefix | the start of every order number (used once checkout exists) |
| Promotion banner on the homepage | show or hide the red strip |
| Customer-service email | where new-conversation emails go (the shop's contact email if empty) |
| Close a quiet conversation after | minutes without a message before a chat closes (2–240, default 10) |

### What admins can never do

- **See a customer's password.** Nobody can — they are stored as one-way
  hashes.
- Set negative stock, stock below what bags hold, a "sale" price that is not
  lower, a VAT over 100%, or a zero-minute bag hold.
- Email anyone who has not confirmed a subscription, or send a mailing with
  no unsubscribe link.

The panel's full instructions are in **`ADMIN.md`**.

---

## 3. Automations — what happens by itself

### Stock that cannot be oversold

- **Adding to bag reserves the item** for the hold time (10 minutes by
  default). Other customers see it as unavailable while it is held.
- **Two people, one last item**: exactly one gets it; the other is told
  plainly that it has just gone. Proven by a test that sends ten shoppers at
  the last unit at once.
- **Abandoned bags give stock back** — a hold that expires returns to the
  shelf the next time anyone looks at that item. No overnight job to forget.
- The database itself refuses negative stock or more reserved than exists —
  even a bug in the code cannot oversell.

### Prices

- **Promotions switch themselves on and off** by their start and end dates,
  and apply to a whole category, a subcategory or chosen products.
- **Never double-discounted**: when a product has a sale price and a
  promotion, the customer gets whichever is cheaper, not both.
- **The browser is never trusted with a price.** Every total is worked out
  again on the server from the database; a price edited in the browser is
  ignored.
- **Promo codes** are checked for dates, minimum spend, total uses and
  one-per-customer. (A use is recorded when an order is placed — so that part
  waits for checkout.)

### Showing the right things

- *New in* fills itself with the newest products, *Moving fast* with the
  most viewed, *On sale* with whatever is currently reduced — including
  promotion discounts.
- **Product views are counted once per person**, so refreshing a page does not
  inflate "most viewed".
- Low stock, sold-out sizes and sale badges update themselves from the stock
  and the prices.

### Sold out, hidden, available

- *Sold out* and *hidden* are checked by the server when anything is added to
  a bag — calling the shop's API directly cannot buy a hidden or sold-out
  piece either.
- A product with no stock left shows as sold out on its own, and comes back on
  sale the moment stock is added.

### Customer Service

- **Quiet conversations close themselves** after the idle time in Settings:
  the server checks every 30 seconds, and every time anyone looks at a
  conversation — so the rule holds even if the timer is not running.
- **Emails**: a new conversation emails staff once; a closed one emails the
  customer the transcript once (if they gave an address). Two people closing
  at the same moment, or staff and the timer, still produce one email.

### Newsletter

- Confirmation, welcome and every mailing go out in the subscriber's language
  (English, Greek or Russian).
- Every yes and every unsubscribe is written to a consent record that is never
  edited — so "did they agree, and when?" always has an answer.

### Automated emails

Every automated email is first a scheduled job with its reason, and is
**checked again at the moment it is due** — so a four-hour-old reminder never
goes to someone who has since bought, emptied the bag or unsubscribed.

- **Welcome** — after the code is accepted, in the customer's language.
- **Abandoned bag** — about **4 hours** after a signed-in customer's bag last
  changed ("You left something behind": image, name, quantity, price,
  *Return to my bag*). Only if the bag still has pieces that can be bought,
  nothing was ordered, they are a **confirmed newsletter subscriber**, and no
  bag reminder went to them in the last 7 days. Every change moves the one
  reminder rather than adding another; an order or an empty bag cancels it.
  Guests are never written to. An optional follow-up, *"Still thinking about
  it?"*, after about 24 hours, has its own switch (off to start).
- **Order emails** — received, payment confirmed, confirmed, preparing,
  ready to collect, shipped (tracking only when there is a real number),
  delivered, completed, cancelled. Each goes once per order; "confirmed" is
  skipped right after "payment confirmed", and "completed" right after
  "delivered", because they would say the same thing. *These are wired and
  tested, and send by themselves once checkout exists.*
- **Back in stock** — "It's back", with the product, colour and size, when a
  size someone asked about returns. The storage and trigger are built; the
  *Notify me* button is not, so nothing sends yet.
- **Review request** — "How did you like your AIONIX order?" a few days
  after delivery; off until the site has reviews.
- **Marketing rules** — only to confirmed subscribers, always with an
  unsubscribe link (no login needed), never two within the frequency limit.
  Account, order and customer-service emails ignore marketing preferences
  and are never held back.

### Accounts

- The registration code **expires after 10 minutes**, allows **5 wrong
  tries**, can be sent **5 times an hour**, with **60 seconds** between
  resends.
- **8 wrong passwords in 15 minutes** locks that email for a while, to stop
  password-guessing.
- A wrong password and an unknown email get **the same message**, so the
  sign-in form cannot be used to find out who is a customer.
- Sessions last 30 days and can be cancelled instantly on the server — signing
  out really ends the session, not just the cookie.

### The hero video

- Loops without a visible join; plays muted; fades in over its first frame.
- **Pauses** when scrolled out of view, and is **not played** for visitors
  whose phone asks for less motion or is saving data. Always has a pause
  button.

### For you, on your laptop

- **`npm run dev` does everything**: starts the database, applies any
  database updates, fills an empty shop with the demo catalogue, links up
  any photos or video in the `public` folder, then starts the site.
- **Drop a photo in `public/products`** with the right name and it appears
  on the next start — no re-seeding, nothing lost. (Names are in `IMAGES.md`.)
- If new code arrives while the site is running, the database is brought up
  to date on the next page load instead of showing an error.

---

## 4. Security

Following the rules in the original brief:

| Requirement | How it is met |
|---|---|
| Passwords never stored readable | bcrypt, cost 12 — one-way; not even an admin can see one |
| No raw card details | none are stored; payment will go straight to Stripe |
| Validate every input | every API checks its input's shape and limits before doing anything |
| Admin routes protected | checked in the admin layout **and** every admin API; outsiders get 404 |
| SQL injection | every query is parameterised; no user text is ever pasted into SQL |
| XSS | React escapes everything shown on the page; every customer-written value is escaped again before it goes into an email |
| Conversations are private | a guest's conversation belongs to a random http-only cookie (the database keeps only its hash); an account's to the account. An id alone opens nothing |
| Consent | no marketing email without a confirmed, recorded yes; unsubscribe links are signed, so nobody can unsubscribe (or subscribe) someone else |
| Never trust the browser | prices, stock, admin status, conversation ownership, the signed-in customer's email and consent are all decided on the server |
| CSRF | session cookie is `SameSite=Lax` and `httpOnly`; writes are JSON-only |
| Rate limiting | sign-in lockout; code sending limited per hour with a cooldown; the chat and the newsletter form limited per visitor and per address |
| Codes expire, limited attempts | 10 minutes, 5 attempts |
| Server-side price, stock, promo checks | always — the browser only sends ids and quantities |
| No secrets in the code | all in environment variables; `.env.example` lists every one |
| Personal data | visitors' IP addresses are stored only as a hash |

Sessions are random tokens of which the database keeps only a fingerprint, so
even a stolen copy of the database cannot be used to sign in as anyone.

---

## 5. How it is built

| | |
|---|---|
| Website | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Database | PostgreSQL, via Drizzle ORM |
| On your laptop | an embedded PostgreSQL that runs from `node_modules` — nothing to install |
| Email | Resend (codes print to the terminal while developing) |
| Payments (planned) | Stripe |

Money is stored as whole cents everywhere, never as decimals, so a total can
never be off by a fraction of a cent.

### The checks

`npm run check` runs **146 checks** against the running site, over the web,
the way a real browser or attacker would:

- **the last-item race** — ten shoppers at once, one unit, never oversold;
- **promo codes** — a forged discount in the request is ignored;
- **product views** — counted once per person, and private;
- **registration and sign-in** — no account before the code, duplicates
  refused, the bag follows you in;
- **the admin panel** — closed to everyone but admins, every change works
  and reaches the shop; sold out and hidden really stop a purchase;
- **Customer Service and the newsletter** — one visitor cannot read another's
  conversation, replies arrive without staff identity, closing emails one
  transcript, and sign-ups need consent and a confirmation;
- **listing filters** — a filtered address renders the filtered products,
  the live count matches the page, groups combine correctly, and junk in the
  address is ignored.

`npm test` runs 223 unit tests on stock, pricing, sizes, views, accounts, the
admin product and stock lists, the newsletter, Customer Service (including
the 10-minute close, the reset on every message, and the emails), and the
listing filters — every price boundary, single and multiple sizes and
colours, stock, sale, and combinations such as "M + Black + €50–€100 + In
stock".
One (two registrations racing for the same phone number) only runs on a full
PostgreSQL server and is skipped on the laptop database, saying so. One other
(recording a view of a product that does not exist) is unreliable on the
laptop database — it passes on some runs and not others, because of how the
embedded database handles an error mid-conversation. Neither affects the
shop.

### The documents in the project folder

| File | What it is for |
|---|---|
| `README.md` | running it, and how it is put together |
| `ADMIN.md` | using the admin panel |
| `IMAGES.md` | the photo and video names, sizes and folders |
| `OVERVIEW.md` | this page — everything built, and what is not |

---

## 6. Not built yet

So you know exactly where it stands:

| Missing | What that means today |
|---|---|
| **Checkout and payment (Stripe)** | the *Checkout* button leads nowhere yet — nothing can be bought |
| **Orders** | no order list for customers or for you, no order numbers issued |
| **Order emails** | written, tested and switched on — they start the day checkout creates orders |
| **Wishlist, saved addresses** | the database is ready; there are no screens |
| **Password reset** | the logic and its email exist; there is no "forgot password" page yet |
| **Notify me when it's back** | the email, storage and trigger are built; the button on sold-out pages is not |
| **Reviews** | no reviews on the site, so the review-request email stays off |
| **Later automations** | first/second order, inactive customer, wishlist, price drop, promotion ending, loyalty — the system has room; not built |
| **Admin: customers** | no customer list |
| **Admin: creating products** | products come from the demo data; names, descriptions and SEO text are shown in the editor's *Details* section but cannot be edited yet |
| **Admin: promotions and codes** | they work, but are set in the demo data, not the panel |
| **Admin: photo upload** | photos go into `public/products` by name |
| **Brand** | still the placeholder `AIONIX`, with `TODO` company details in the footer — one file, `src/config/brand.ts` |
| **Going live** | not yet deployed to Render; the demo admin password must be changed first |
| **Search misspellings** | "hoddie" or "legings" find nothing yet; the typo matching compares against a product's whole text instead of single words — a small fix |
| **Sitemap for Google** | not yet |

The natural next step is **checkout with Stripe and orders**, because that is
what turns the shop from a catalogue into something that takes money.
