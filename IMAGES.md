# Photographs to send

Everything in the shop is currently drawn: AIONIX branded packshots generated
by `npm run art`, so the shop looks finished before the real photography
arrives. Every one of them is replaced by dropping a file with the right
**name** into the right **folder**. No code changes, no deploy.

The rule is the same everywhere: **a photo with the matching name wins; where
there is no photo, the drawing stays.** So you can send five files or fifty, in
any order, and the shop keeps working the whole way through.

Accepted formats: `.jpg` `.jpeg` `.png` `.webp` `.avif`. **JPG is fine.** Name
them in lowercase exactly as listed; Windows hides extensions by default, so
turn on *View, File name extensions* in File Explorer before renaming.

After copying files in:

```powershell
npm run db:seed
```

---

## 1. Products, `public\products\`

Sixteen products. The **front** file is the one that matters; the **back** is
optional (the nutrition label side) and is what the card cross fades to on
hover. Where there is no back photo, the front is shown again.

| # | Product | Front (required) | Back (optional) |
|---|---|---|---|
| 1 | Whey Protein Isolate | `whey-protein-isolate.jpg` | `whey-protein-isolate-back.jpg` |
| 2 | 100% Whey Protein | `whey-protein-100.jpg` | `whey-protein-100-back.jpg` |
| 3 | Vegan Protein Blend | `vegan-protein-blend.jpg` | `vegan-protein-blend-back.jpg` |
| 4 | Creatine Monohydrate | `creatine-monohydrate.jpg` | `creatine-monohydrate-back.jpg` |
| 5 | Creatine HCL Capsules | `creatine-hcl-capsules.jpg` | `creatine-hcl-capsules-back.jpg` |
| 6 | Ignite Pre Workout | `pre-workout-ignite.jpg` | `pre-workout-ignite-back.jpg` |
| 7 | Pump Stim Free | `stim-free-pump.jpg` | `stim-free-pump-back.jpg` |
| 8 | BCAA 2:1:1 | `bcaa-2-1-1.jpg` | `bcaa-2-1-1-back.jpg` |
| 9 | L Glutamine | `l-glutamine.jpg` | `l-glutamine-back.jpg` |
| 10 | Mass Gainer | `mass-gainer.jpg` | `mass-gainer-back.jpg` |
| 11 | Daily Multivitamin | `daily-multivitamin.jpg` | `daily-multivitamin-back.jpg` |
| 12 | Vitamin D3 + K2 | `vitamin-d3-k2.jpg` | `vitamin-d3-k2-back.jpg` |
| 13 | Omega 3 Fish Oil | `omega-3-fish-oil.jpg` | `omega-3-fish-oil-back.jpg` |
| 14 | L Carnitine Capsules | `l-carnitine-capsules.jpg` | `l-carnitine-capsules-back.jpg` |
| 15 | Protein Bar, Box of 12 | `protein-bar-box.jpg` | `protein-bar-box-back.jpg` |
| 16 | AIONIX Shaker | `aionix-shaker.jpg` | `aionix-shaker-back.jpg` |

**Shape:** portrait, 3:4 (e.g. 1200 × 1600).

**What works best:** every tub and bag shot the same way, on the same dark
background (close to `#0B0B0B` or `#1A1A1A`) so they sit naturally on the
site, same distance, same crop. Mixing a white studio shot with a gym photo is
the single thing that makes a shop look assembled rather than designed.

---

## 2. Category tiles, `public\products\`

Ten tiles, one per section in the menu and on the homepage.

**Sports Nutrition**

| Section | File |
|---|---|
| Protein | `category-sports-nutrition-protein.jpg` |
| Creatine | `category-sports-nutrition-creatine.jpg` |
| Pre Workout | `category-sports-nutrition-pre-workout.jpg` |
| Amino Acids & BCAA | `category-sports-nutrition-amino-acids.jpg` |
| Mass Gainers | `category-sports-nutrition-mass-gainers.jpg` |

**Health & Wellness**

| Section | File |
|---|---|
| Vitamins & Minerals | `category-health-wellness-vitamins.jpg` |
| Omega 3 & Fish Oil | `category-health-wellness-omega-3.jpg` |
| Weight Management | `category-health-wellness-weight-management.jpg` |
| Protein Bars & Snacks | `category-health-wellness-bars-snacks.jpg` |
| Shakers & Accessories | `category-health-wellness-accessories.jpg` |

**Shape:** portrait, 3:4.

---

## 3. Hero, `public\hero\`

The top of the homepage is the AIONIX logo video: a runner draws the "A" in
yellow light. It is muted and loops seamlessly (the finished logo holds for a
moment, then dissolves back into the start).

| File | What it is |
|---|---|
| `hero.mp4` / `hero.webm` | desktop loop. The scene is widened on the left so the logo sits to the right of the headline |
| `hero-mobile.mp4` / `hero-mobile.webm` | phone loop, 2:3, with the logo at the top and room for the headline below |
| `hero.jpg` / `hero-mobile.jpg` | first frame, shown instantly while the video loads, and instead of it for visitors who ask for reduced motion or data saving |

To change it, send a new clip (5 to 10 seconds, landscape, no text in it) and
it gets the same treatment. Without any video, the hero falls back to
`hero.jpg`, and without that to the drawn `hero.svg`.

---

## Brand files, `public\brand\`

| File | What it is |
|---|---|
| `aionix-mark.png` | the "A" mark on its own, transparent (header) |
| `aionix-wordmark.png` | the AIONIX wordmark, transparent (header) |
| `aionix-logo.png` | mark, wordmark and "Supplement Store" (footer) |
| `aionix-icon.png` | the mark on a 1024 square, transparent |

The browser tab icon is `src\app\icon.png`, `src\app\apple-icon.png` and
`src\app\favicon.ico`, all made from the same mark.

---

## The one thing to say plainly

These images will be on a public shop, so they have to be yours to use:
photographs you or someone you hired took, the manufacturer's official
packshots that you are allowed to use as a stockist, or stock you have
licensed. Do not take images from another shop's website; their photography
is their copyright.
