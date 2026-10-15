# Running the shop

The admin panel is at **`/admin`**. It is not linked from anywhere on the
storefront on purpose — you type the address.

---

## 1. Getting in

You need an account whose role is `ADMIN` or `SUPER_ADMIN`.

The seed creates one:

| | |
|---|---|
| Address | `admin@example.com` |
| Password | `change-me-in-production` |

**Change that password before the site is on the internet.** Sign in at
`/en/sign-in`, then go to `/admin`.

To create your real owner account:

1. Register normally at `/en/register` with the email you actually use.
2. Promote it, once, from a terminal:

   ```powershell
   npm run db:studio
   ```

   Open the `users` table, find your row, change `role` from `CUSTOMER` to
   `SUPER_ADMIN`, save.

3. Sign out and in again, then delete or disable `admin@example.com`.

There is no "make someone an admin" button in the panel yet. That is
deliberate: the one action that can hand over the whole shop should not sit
one mis-click away, and adding it is a small job for later.

### Who can see what

| | Storefront | `/admin` |
|---|---|---|
| Not signed in | yes | sent to the sign-in page |
| Customer | yes | **404 — page not found** |
| Admin / Super admin | yes | yes |

A signed-in customer who guesses the address gets the ordinary 404 page, not
"access denied". Saying "denied" would confirm there is something there.

**You cannot see any customer's password.** Nobody can — passwords are stored
as bcrypt hashes and the original is not recoverable from them. If a customer
is locked out, the answer is a password reset, never you reading it back to
them.

---

## 2. The screens

### Overview — `/admin`

Four blocks:

- **Today** — orders, revenue, new customers and open conversations. Orders
  and revenue stay at zero until checkout exists.
- **Customer activity** — new customers today, open conversations, newsletter
  subscribers, abandoned bags (signed-in bags untouched for an hour), emails
  scheduled and emails sent today. Each number opens the list behind it.
- **Inventory** — sizes sold out, sizes low, units held in carts, products live.
- **Needs attention** — customers waiting for a reply (unread in bold), the
  sizes to restock, and any email that did not go out in the last 7 days.

*Held* is stock sitting in a live customer's bag. It is not a problem — it is
the reservation system stopping two people buying the last one — but it
explains why a size with 1 on the shelf can say **None left**: that one unit
is already promised to someone at checkout. Holds expire on their own (10
minutes by default, see Settings) and the unit comes back.

### Stock — `/admin/stock`

One line per **variant**: every colour of every size of every product. Each
line shows the photo, product, colour (a swatch and its name), size, SKU,
**on shelf**, **held**, **available**, and the product's status when it is
not simply available.

**Quick views**, with how many lines each holds:

| View | Shows |
|---|---|
| Needs attention | low or none left, on products customers can buy (not hidden, not marked sold out). The screen opens here whenever there is anything in it. |
| All | everything |
| Low stock | 1 to the low-stock number available |
| Sold out | none available |
| In stock | at least one available |

**Search** takes product names, SKUs, colours and sizes, several at once:
`chocolate`, `1kg`, `whey`, `chocolate 1kg`. A size on its own means exactly that
size — `s` is small, not every product with an S in its name.

**Filters** for department, category, colour and size, and **sort** by
attention (sold out, then low, first), available, product, category, colour
or size. Every choice shows as a chip under the search; × removes one,
**Clear all filters** removes them all. The address bar keeps the view, so a
filtered list can be bookmarked.

**Editing**:

- Click a number, type what is on the shelf, press **Enter**. It saves
  ("Saving…", then "Saved ✓") and jumps to the next line — so counting a rail
  is type, Enter, type, Enter.
- **↑ / ↓** move between lines; **Escape** puts a line back; clicking away
  saves too.
- Lines do not jump around after a save. Change view or reload to re-sort.
- *Available* = *on the shelf* − *held in carts*. You set the shelf number;
  the shop computes the rest.

**You cannot set a count below what carts are holding.** If 5 units are in
customer bags and you type 2, the save is refused, the line says why, and the
box goes back to the real number.

### Products — `/admin/products`

- **Search** by name, SKU, category or product ID, as you type.
- **Filters** — Department, Category, Status (available / marked sold out /
  hidden), Stock (in stock / some sizes low or out / none at all), Sale (on
  sale / full price) and Price (what the customer pays today). They combine,
  show as chips, and clear one at a time or all at once.
- **Sort** by newest, name, price or least stock.
- Each row shows a small photo, name, category, first SKU (and how many more),
  price, units available, and status. **Click anywhere on a row** to edit it.

### One product — `/admin/products/<id>`

Sections, with a jump list on the left:

- **Status** — pick one:

  | | In the shop | In categories and search | Can be bought |
  |---|---|---|---|
  | **Available** | yes | yes | any size with stock |
  | **Sold out** | yes, marked SOLD OUT | yes | no, whatever the stock says |
  | **Hidden** | no | no | no |

  Saved as soon as you choose. Nothing is deleted by either — stock, photos
  and past orders stay exactly as they are. An *Available* product whose
  sizes are all at zero already shows as sold out in the shop, and is back
  on sale the moment you add stock.
- **Pricing** — **Price** and **Sale price** in euros. A sale price must be
  lower than the normal price. Empty sale price = no sale. An automatic
  promotion never stacks on top of a sale price — the customer pays
  whichever is cheaper.
- **Photos** — drag to reorder. The **first** photo is the one on every card
  and at the top of the product page; the **second** is the one a card fades
  to when a shopper points at it. Saved as soon as you let go.
- **Variants & stock** — one line per colour and size, edited exactly as on
  the Stock screen.
- **Details** — name, summary, address and ID, for reference. Editing names,
  descriptions and search-engine text here is the next step for this screen.

Every status and price change is written to the audit log with who made it.

### Homepage — `/admin/homepage`

Everything under the hero video, arranged by drag and drop.

**Order of the page** — the five sections as rows: Shop by category, Moving
fast, Just dropped (new in), the **Be first to know** newsletter sign-up, and
On sale. Drag a row by its ⠿ grip
to move it; the switch on the right hides a section without losing what you
picked for it. The hero and the promotion strip always stay at the top.

**Each section** then has its own panel, with two modes:

| | Automatic | Hand-picked |
|---|---|---|
| Shop by category | the first four sections of each range | exactly the categories you choose, up to 16 |
| Moving fast | the 12 most-viewed products | your products, up to 24 |
| New in | the 8 newest products | your products, up to 12 |
| On sale | up to 4 reduced products | your products, up to 12 |

The newsletter sign-up has nothing to pick — only its place and its switch.
By default it sits straight after *Just dropped*.

Switching to **Hand-picked** starts from what the section is showing right
now, so you begin with today's homepage and rearrange it. Then:

- **Drag** a card to move it. Other cards slide aside; the number in the
  corner is its position on the homepage.
- **×** removes a card (it stays in the shop — only off the homepage).
- **+ Add** opens a picker: search, click the ones you want, press Add.
- Switching back to **Automatic** keeps your picks, so you can return to them.

On a phone, drag by the ⠿ grip — swiping anywhere else scrolls the page. With
a keyboard, Tab to a grip and use the arrow keys; Home and End jump to either
end.

A few rules keep the homepage honest, and the panel tells you when one applies:

- **On sale** will not accept a product that is not reduced, and a product
  whose sale ends drops out of the section by itself — never shown at full
  price under a "Sale" heading.
- A product hidden from the shop is not shown on the homepage either.
- **Moving fast** needs at least 3 products; a strip of one or two looks like
  a glitch, so it stays hidden until there are three.
- A hand-picked section with nothing in it is not shown.

Every change is live on the next page load — a "✓ Saved" note appears in the
corner. If a save fails, the screen goes back to what the homepage is really
using and says why.

### Customer service — `/admin/support`

The chat from the shop. Customers see a **Customer service** button on every
page; the panel it opens is headed **AIONIX Customer Service**.

- **Open**, **Closed** and **All** tabs, most recent activity first. Each
  conversation shows the customer's name and email, **Guest** or **Signed
  in**, the last
  message, how long ago, and a red count of messages you have not read. The
  **Customer service** link in the admin menu shows the number waiting.
- Click one to read it. Type a reply and press **Enter** (Shift+Enter for a
  new line). It appears in the customer's panel within a few seconds, from
  *AIONIX Customer Service* — the customer never sees which of you replied.
- You also see whether they are signed in, their language, and the page they
  were on when they asked.
- **Close conversation** asks first. The customer sees that it has ended and,
  if they gave an email, receives a copy of the whole conversation.
- A conversation with **no message for 10 minutes** (Settings) closes by
  itself and sends the same copy. Every message — theirs or yours — restarts
  the 10 minutes. The thread shows how long is left.
- Closed conversations are kept. Nothing is ever deleted; the customer starts
  a new one if they need to.
- A guest gives a name and email to start; a signed-in customer is never
  asked. Right after the first message the customer gets the **automatic
  first reply**, shown here marked *automatic reply*. Change its words (EN,
  EL, RU) or switch it off under **Automatic first reply** at the top of the
  page.

When a customer starts a conversation, an email (**New customer support
conversation**) goes to the customer-service address in Settings, with their
name, email, the time, the first message and a button that opens it here.
One email per conversation, not one per message.

### Marketing & Emails — `/admin/emails`

Every email the shop sends. (The old Newsletter screen lives here now;
`/admin/newsletter` takes you to it.)

**Automated emails** — the table of every automatic email: *Automation ·
Type · Trigger · Status · Action*. **Required** ones (verification code,
password reset and change, order emails, the chat transcript) are always on
— you can change their words but not switch them off. Optional ones —
welcome, abandoned bag, its follow-up, back in stock, review request — have
a switch.

Click **Edit**:

- **Send this email** on/off, and the **timing** where there is one (the bag
  reminder: 1–48 hours, 4 to start).
- **English / Greek / Russian** tabs with the subject, the text and the
  button. A language you leave as it is keeps the built-in words; English is
  used for any language with none.
- **Variables** like `{{customer_name}}` or `{{order_number}}` are listed
  beside the text with what they mean — click one to insert it. Anything
  else in `{{ }}` is refused when you save. The text is plain: HTML or code
  typed here shows as text, never runs.
- The **preview** on the right updates as you type, with sample values.
- **Send test email** sends what is on screen (saved or not) to the test
  address in Settings, marked *[Test]*. It cannot go anywhere else.
- **Reset words** goes back to the built-in text.

**Campaigns** — mailings to newsletter subscribers:

1. *New arrivals* or *Promotion*, a subject and a message.
2. **Products**: automatic (newest in stock / newest reduced, taken from the
   live shop when it sends), **one category**, or **up to six picked by
   hand** (sold-out ones are left out when it sends).
3. The **button** — its words and where it goes (new arrivals, sale, a
   category, the front page).
4. For a promotion, an optional **code** and **valid until** (create the code
   in promotions first so it works at checkout).
5. **Send to** everyone (each in their language) or one language — the count
   is shown — and **when**: now, or a date and time.
6. **Send test email** (choose the language), then **Send / Schedule** —
   which asks first, naming the number of people.

Only confirmed subscribers receive anything, and anyone who had a marketing
email within the frequency limit is skipped for this one (shown as
*skipped*). A scheduled mailing can be **cancelled** until it starts.

**Subscribers** — confirmed people clicked the link in the confirmation email
— only they receive marketing. *Waiting to confirm* said yes but have not
clicked. *Unsubscribed* are kept, with the date, and never mailed again
unless they sign up afresh. Unsubscribing never needs a login.

**Email activity** — everything sent, scheduled or not sent, newest first,
with the recipient, the email, subject, when it was triggered, scheduled and
sent, the status, and **why**. Filter by status or email, or search. This is
where to look when someone says "I never got it" — or "why did I get this?".

**Settings** — the **test email address** (the only place tests go; empty
switches test sends off), and the **marketing frequency limit** (hours
between marketing emails to one person; 0 = no limit).

With no email service configured (`EMAIL_API_KEY`) every email is written to
Email activity and the server log instead, and the screens say so.

### Settings — `/admin/settings`

Saved here, used by the shop on the next page load. No deploy, no developer.

| Setting | What it does |
|---|---|
| Free delivery over | The total at which delivery becomes free. Drives the progress bar in the bag. |
| Hold stock in a cart for | How long an unchecked-out item stays reserved. 1–60 minutes. Longer is kinder on a slow checkout; shorter puts stock back sooner. |
| VAT rate | Prices are shown VAT-inclusive, as EU consumer law requires. This is only used to show how much of a total *is* VAT — it never adds anything on top. |
| Low stock warning at | The number at which a size is flagged here and shown as "only a few left" in the shop. |
| Maximum per size in one order | Stops one person clearing out a size. Does not limit how many different items they buy. |
| Delivery estimate | The range shown on the product page and in the confirmation email. |
| Order number prefix | The start of every order number, e.g. `SF-7K2M9QX4`. 1–6 capitals or digits. |
| Promotion banner on the homepage | Switches the banner off without deleting any promotion. The discounts keep working. |
| Customer-service email | Where "New customer support conversation" emails go. Empty = the shop's contact email in `src/config/brand.ts`. |
| Close a quiet conversation after | Minutes without a message before a chat closes by itself and the customer is emailed a copy. 2–240, default 10. |

---

## 3. Things the panel will not let you do

These are not missing features; they are refusals, and each one is checked on
the server, so they hold even if someone bypasses the screen entirely.

- Set stock below what live carts hold.
- Set a sale price at or above the normal price.
- Set a cart hold under 1 minute or over 60.
- Set a VAT rate over 100%, a negative price, or a fractional unit of stock.
- Put a product that is not reduced into **On sale**, a product into **Shop
  by category**, or the same item into a section twice.
- Read anybody's password.
- Email anyone who has not confirmed a subscription, or start a second
  mailing while one is sending.
- Reply into a closed conversation.

If a refusal appears, the number on screen goes back to what is actually
stored. The screen never shows you a figure the database does not have.

---

## 4. Proving it still works

```powershell
npm run check:admin
```

With the site running (`npm run dev`), this signs in as a stranger, as a
customer and as an admin, and checks 90 things: that the first two are turned
away from every page and every API, that their write attempts changed nothing
in the database, that an admin can make each kind of change, that stock cannot
go below what carts hold, that a settings change reaches the storefront on
the very next request, and that homepage and photo ordering is refused to
anyone but an admin and shows up on the homepage straight away, and that
*Sold out* and *Hidden* really stop a purchase — even through the API. It
puts every value it touched back afterwards.

```powershell
npm run check:service
```

does the same for Customer Service and the newsletter: one visitor cannot
read another's conversation, replies arrive without staff identity, closing
sends one transcript, the inbox is closed to non-admins, and sign-ups need
consent and a confirmation click.

`npm run check` runs both plus the stock-race, promotion, recently-viewed and
sign-in suites.

---

## 5. Not built yet

So you know what you are looking at rather than looking for it:

- Orders — there is no checkout yet, so there is nothing to list.
- Creating or deleting products, editing names and descriptions, uploading
  new photos from the browser (they go in `public/products` for now — see
  `IMAGES.md`).
- Managing promotions and promo codes (they work; they are set in the seed).
- Customer list, password reset, promoting a user to admin.
- "Notify me when it's back" on sold-out pieces.
- Choosing products by hand for a mailing.
