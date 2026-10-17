/* ============================================================================
 * Seed data.
 *
 * The AIONIX supplement catalogue: two ranges (Sports Nutrition, Health &
 * Wellness), sixteen placeholder products with real pack sizes, flavours and
 * uneven stock, because that is what exposes bugs. A catalogue where
 * everything has 100 of every size tests nothing.
 *
 * Product names and copy are generic placeholders. Replace them with the real
 * stock (brand, name, nutrition table) from the admin panel or here.
 *
 * Deliberately includes: a sold-out size, a nearly-sold-out size, an item on
 * sale, an active category promotion, and a promo code. Every one of those is
 * a state the UI has to handle.
 *
 * Idempotent: running it twice wipes and reseeds rather than duplicating.
 * ========================================================================== */

import './load-env'

import { sql } from 'drizzle-orm'
import { db, pool } from '../src/db'
import {
  addresses,
  cartItems,
  carts,
  categories,
  contactRequests,
  deliveryOptions,
  heroBanners,
  inventory,
  inventoryReservations,
  invoices,
  marketingConsents,
  orderItems,
  orders,
  otpCodes,
  payments,
  productImages,
  productVariants,
  productViews,
  products,
  promoCodeUsage,
  promoCodes,
  promotions,
  sessions,
  settings,
  users,
  webhookEvents,
  wishlistItems,
  wishlists,
} from '../src/db/schema'
import { artUrl, categoryArtUrl, heroArtUrl, heroVideoUrl } from './art-manifest'
import { hashPassword } from '../src/lib/auth/password'
import { seedMissingSettings } from '../src/lib/settings'

/* Product imagery lives in public/products as real files — see
   scripts/generate-art.ts (`npm run art`) and scripts/art-manifest.ts. The seed
   only references them, so dropping a photograph into that folder replaces the
   drawing with no change here. */

/* Hero stand-in. Carries no text — the headline, subtitle and buttons are real
   DOM over the top of it, so anything written into the artwork double-prints.
   Just tone and a little depth so the overlay has something to sit on. */
function heroPlaceholder(w: number, h: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2b2e34"/><stop offset="1" stop-color="#0b0c0f"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.68" cy="0.32" r="0.55">
      <stop offset="0" stop-color="rgba(255,255,255,.10)"/>
      <stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#base)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <g fill="none" stroke="rgba(255,255,255,.05)" stroke-width="1.5">
    <path d="M${w * 0.55} 0 L${w} ${h * 0.62}"/>
    <path d="M${w * 0.68} 0 L${w} ${h * 0.44}"/>
    <path d="M${w * 0.42} ${h} L${w} ${h * 0.18}"/>
  </g>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const CATEGORY_TREE = [
  {
    slug: 'sports-nutrition',
    name: { en: 'Sports Nutrition', el: 'Αθλητική Διατροφή', ru: 'Спортивное питание' },
    children: [
      { slug: 'protein', name: { en: 'Protein', el: 'Πρωτεΐνες', ru: 'Протеин' } },
      { slug: 'creatine', name: { en: 'Creatine', el: 'Κρεατίνη', ru: 'Креатин' } },
      { slug: 'pre-workout', name: { en: 'Pre Workout', el: 'Pre Workout', ru: 'Предтренировочные' } },
      { slug: 'amino-acids', name: { en: 'Amino Acids & BCAA', el: 'Αμινοξέα & BCAA', ru: 'Аминокислоты и BCAA' } },
      { slug: 'mass-gainers', name: { en: 'Mass Gainers', el: 'Gainers', ru: 'Гейнеры' } },
    ],
  },
  {
    slug: 'health-wellness',
    name: { en: 'Health & Wellness', el: 'Υγεία & Ευεξία', ru: 'Здоровье' },
    children: [
      { slug: 'vitamins', name: { en: 'Vitamins & Minerals', el: 'Βιταμίνες & Μέταλλα', ru: 'Витамины и минералы' } },
      { slug: 'omega-3', name: { en: 'Omega 3 & Fish Oil', el: 'Ωμέγα 3', ru: 'Омега 3' } },
      { slug: 'weight-management', name: { en: 'Weight Management', el: 'Διαχείριση Βάρους', ru: 'Контроль веса' } },
      { slug: 'bars-snacks', name: { en: 'Protein Bars & Snacks', el: 'Μπάρες & Σνακ', ru: 'Батончики и снеки' } },
      { slug: 'accessories', name: { en: 'Shakers & Accessories', el: 'Σέικερ & Αξεσουάρ', ru: 'Шейкеры и аксессуары' } },
    ],
  },
] as const

type L = Record<string, string>

/* Flavours. The colour is what the swatch and the filter show. */
const F = {
  chocolate: { name: { en: 'Chocolate', el: 'Σοκολάτα', ru: 'Шоколад' }, hex: '#5a3825' },
  vanilla: { name: { en: 'Vanilla', el: 'Βανίλια', ru: 'Ваниль' }, hex: '#efe2b5' },
  strawberry: { name: { en: 'Strawberry', el: 'Φράουλα', ru: 'Клубника' }, hex: '#e5677d' },
  doubleChocolate: { name: { en: 'Double Chocolate', el: 'Διπλή Σοκολάτα', ru: 'Двойной шоколад' }, hex: '#3d2416' },
  cookies: { name: { en: 'Cookies & Cream', el: 'Cookies & Cream', ru: 'Печенье со сливками' }, hex: '#d9d4cc' },
  caramel: { name: { en: 'Salted Caramel', el: 'Αλατισμένη Καραμέλα', ru: 'Солёная карамель' }, hex: '#c6873e' },
  berry: { name: { en: 'Mixed Berry', el: 'Μούρα', ru: 'Ягодный микс' }, hex: '#8e3b6b' },
  unflavoured: { name: { en: 'Unflavoured', el: 'Χωρίς γεύση', ru: 'Без вкуса' }, hex: '#cfcfcf' },
  blueRaspberry: { name: { en: 'Blue Raspberry', el: 'Μπλε Βατόμουρο', ru: 'Голубая малина' }, hex: '#2f7de1' },
  fruitPunch: { name: { en: 'Fruit Punch', el: 'Fruit Punch', ru: 'Фруктовый пунш' }, hex: '#d94a4a' },
  sourApple: { name: { en: 'Sour Apple', el: 'Ξινό Μήλο', ru: 'Кислое яблоко' }, hex: '#8fd14f' },
  watermelon: { name: { en: 'Watermelon', el: 'Καρπούζι', ru: 'Арбуз' }, hex: '#ef5a6f' },
  lemonLime: { name: { en: 'Lemon Lime', el: 'Λεμόνι Λάιμ', ru: 'Лимон лайм' }, hex: '#c8e04a' },
  tropical: { name: { en: 'Tropical', el: 'Τροπικά Φρούτα', ru: 'Тропик' }, hex: '#f2a33a' },
  peachTea: { name: { en: 'Peach Iced Tea', el: 'Ροδάκινο Ice Tea', ru: 'Персиковый чай' }, hex: '#f3a77e' },
  chocPeanut: { name: { en: 'Chocolate Peanut', el: 'Σοκολάτα Φυστίκι', ru: 'Шоколад арахис' }, hex: '#7b4a2a' },
  none: { name: { en: 'Standard', el: 'Κανονικό', ru: 'Стандарт' }, hex: '#2e2e2e' },
  yellow: { name: { en: 'AIONIX Yellow', el: 'Κίτρινο AIONIX', ru: 'Жёлтый AIONIX' }, hex: '#ffe600' },
}

type Flavour = { name: L; hex: string }

type SeedProduct = {
  parent: 'sports-nutrition' | 'health-wellness'
  category: string
  slug: string
  name: L
  summary: L
  description: L
  /** Shown under "Nutrition & usage" on the product page. */
  usage: L
  /** Price of the first (smallest) size. */
  priceCents: number
  salePriceCents?: number
  /** Pack sizes, smallest first, each with its own price when it differs. */
  sizes: { size: string; priceCents?: number; salePriceCents?: number }[]
  flavours: Flavour[]
  /** Stock per "flavour|size" or per size. Missing ones get the default. */
  stock?: Record<string, number>
  defaultStock?: number
}

const PRODUCTS: SeedProduct[] = [
  {
    parent: 'sports-nutrition',
    category: 'protein',
    slug: 'whey-protein-isolate',
    name: { en: 'Whey Protein Isolate', el: 'Whey Protein Isolate', ru: 'Изолят сывороточного протеина' },
    summary: {
      en: '27g protein per serving, low sugar, low fat',
      el: '27g πρωτεΐνης ανά μερίδα, χαμηλά σάκχαρα και λιπαρά',
      ru: '27 г белка в порции, мало сахара и жиров',
    },
    description: {
      en: 'Cross flow micro filtered whey isolate with 27g of protein in every 30g scoop. It mixes smooth with water in seconds and keeps sugar and fat to a minimum, so it fits easily around training, breakfast or a busy day. Protein contributes to the growth and maintenance of muscle mass.',
      el: 'Ισολάτη πρωτεΐνης ορού γάλακτος με 27g πρωτεΐνης σε κάθε δόση 30g. Διαλύεται εύκολα στο νερό, με ελάχιστα σάκχαρα και λιπαρά. Η πρωτεΐνη συμβάλλει στην αύξηση και διατήρηση της μυϊκής μάζας.',
      ru: 'Изолят сывороточного белка: 27 г белка в каждой порции 30 г. Легко размешивается в воде, минимум сахара и жиров. Белок способствует росту и поддержанию мышечной массы.',
    },
    usage: {
      en: 'Mix one scoop (30g) with 250 to 300ml of cold water or milk. Take after training or between meals. Per 30g: 112 kcal, protein 27g, carbohydrate 1g, fat 0.3g.',
      el: 'Ανάμειξε μία δόση (30g) με 250 έως 300ml κρύο νερό ή γάλα. Μετά την προπόνηση ή ανάμεσα στα γεύματα. Ανά 30g: 112 kcal, πρωτεΐνη 27g.',
      ru: 'Смешайте одну мерную ложку (30 г) с 250 до 300 мл холодной воды или молока. После тренировки или между приёмами пищи. На 30 г: 112 ккал, белок 27 г.',
    },
    priceCents: 3990,
    sizes: [{ size: '1kg', priceCents: 3990 }, { size: '2kg', priceCents: 6490 }],
    flavours: [F.chocolate, F.vanilla, F.strawberry],
    stock: { '1kg': 14, '2kg': 9, 'Strawberry|2kg': 0, 'Vanilla|2kg': 2 },
  },
  {
    parent: 'sports-nutrition',
    category: 'protein',
    slug: 'whey-protein-100',
    name: { en: '100% Whey Protein', el: '100% Whey Protein', ru: '100% сывороточный протеин' },
    summary: {
      en: '24g protein per serving, great everyday value',
      el: '24g πρωτεΐνης ανά μερίδα, για κάθε μέρα',
      ru: '24 г белка в порции, на каждый день',
    },
    description: {
      en: 'Our everyday whey: a blend of concentrate and isolate with 24g of protein and 5g of naturally occurring BCAAs in every scoop. Rich flavours that taste just as good with water as with milk.',
      el: 'Η καθημερινή μας πρωτεΐνη: μείγμα συμπυκνωμένης και ισολάτης με 24g πρωτεΐνης και 5g BCAA ανά δόση. Πλούσιες γεύσεις με νερό ή γάλα.',
      ru: 'Протеин на каждый день: смесь концентрата и изолята, 24 г белка и 5 г BCAA в порции. Насыщенный вкус с водой или молоком.',
    },
    usage: {
      en: 'Mix one scoop (31g) with 200 to 250ml of water or milk, once or twice a day. Per 31g: 120 kcal, protein 24g, carbohydrate 3g, fat 1.5g.',
      el: 'Ανάμειξε μία δόση (31g) με 200 έως 250ml νερό ή γάλα, μία ή δύο φορές την ημέρα.',
      ru: 'Смешайте одну порцию (31 г) с 200 до 250 мл воды или молока, один или два раза в день.',
    },
    priceCents: 2990,
    sizes: [{ size: '1kg', priceCents: 2990 }, { size: '2.27kg', priceCents: 5490 }],
    flavours: [F.doubleChocolate, F.cookies, F.caramel],
    defaultStock: 12,
  },
  {
    parent: 'sports-nutrition',
    category: 'protein',
    slug: 'vegan-protein-blend',
    name: { en: 'Vegan Protein Blend', el: 'Vegan Πρωτεΐνη', ru: 'Веганский протеин' },
    summary: {
      en: 'Pea and rice protein, 22g per serving',
      el: 'Πρωτεΐνη μπιζελιού και ρυζιού, 22g ανά μερίδα',
      ru: 'Белок гороха и риса, 22 г в порции',
    },
    description: {
      en: 'A plant based blend of pea and brown rice protein for a complete amino acid profile. Dairy free, soy free and smooth enough to drink with just water.',
      el: 'Φυτικό μείγμα πρωτεΐνης μπιζελιού και καστανού ρυζιού με πλήρες προφίλ αμινοξέων. Χωρίς γαλακτοκομικά και σόγια.',
      ru: 'Растительная смесь белка гороха и бурого риса с полным аминокислотным профилем. Без молочных продуктов и сои.',
    },
    usage: {
      en: 'Mix one scoop (30g) with 300ml of water or plant milk. Per 30g: 115 kcal, protein 22g.',
      el: 'Ανάμειξε μία δόση (30g) με 300ml νερό ή φυτικό γάλα.',
      ru: 'Смешайте одну порцию (30 г) с 300 мл воды или растительного молока.',
    },
    priceCents: 3490,
    sizes: [{ size: '1kg' }],
    flavours: [F.chocolate, F.berry],
    defaultStock: 8,
  },
  {
    parent: 'sports-nutrition',
    category: 'creatine',
    slug: 'creatine-monohydrate',
    name: { en: 'Creatine Monohydrate', el: 'Κρεατίνη Μονοϋδρική', ru: 'Креатин моногидрат' },
    summary: {
      en: 'Pure micronised creatine, 3g per serving',
      el: 'Καθαρή μικρονισμένη κρεατίνη, 3g ανά μερίδα',
      ru: 'Чистый микронизированный креатин, 3 г в порции',
    },
    description: {
      en: 'One ingredient and nothing else: micronised creatine monohydrate that dissolves easily in any drink. Creatine increases physical performance in successive bursts of short term, high intensity exercise, with a daily intake of 3g.',
      el: 'Ένα συστατικό και τίποτα άλλο: μικρονισμένη μονοϋδρική κρεατίνη που διαλύεται εύκολα. Η κρεατίνη αυξάνει τη σωματική απόδοση σε διαδοχικές σύντομες ασκήσεις υψηλής έντασης, με ημερήσια πρόσληψη 3g.',
      ru: 'Один ингредиент: микронизированный креатин моногидрат, который легко растворяется. Креатин повышает физическую работоспособность при коротких интенсивных нагрузках при суточном приёме 3 г.',
    },
    usage: {
      en: 'Take 3g (one level scoop) a day with water, juice or your shake. Drink plenty of water during the day.',
      el: 'Λάβε 3g (μία δόση) την ημέρα με νερό, χυμό ή το ρόφημά σου.',
      ru: 'Принимайте 3 г (одна мерная ложка) в день с водой, соком или коктейлем.',
    },
    priceCents: 1990,
    sizes: [{ size: '300g', priceCents: 1990 }, { size: '500g', priceCents: 2990, salePriceCents: 2490 }],
    flavours: [F.unflavoured],
    stock: { '300g': 20, '500g': 16 },
  },
  {
    parent: 'sports-nutrition',
    category: 'creatine',
    slug: 'creatine-hcl-capsules',
    name: { en: 'Creatine HCL Capsules', el: 'Κρεατίνη HCL Κάψουλες', ru: 'Креатин HCL в капсулах' },
    summary: { en: '750mg creatine HCL per capsule', el: '750mg κρεατίνη HCL ανά κάψουλα', ru: '750 мг креатина HCL в капсуле' },
    description: {
      en: 'Creatine hydrochloride in easy capsules, for training days when you would rather not mix a powder.',
      el: 'Υδροχλωρική κρεατίνη σε κάψουλες, για όσους δεν θέλουν να αναμειγνύουν σκόνη.',
      ru: 'Креатин гидрохлорид в капсулах для тех, кто не хочет смешивать порошок.',
    },
    usage: {
      en: 'Take 4 capsules a day with water.',
      el: 'Λάβε 4 κάψουλες την ημέρα με νερό.',
      ru: 'Принимайте 4 капсулы в день с водой.',
    },
    priceCents: 2490,
    sizes: [{ size: '120 caps' }],
    flavours: [F.none],
    defaultStock: 3,
  },
  {
    parent: 'sports-nutrition',
    category: 'pre-workout',
    slug: 'pre-workout-ignite',
    name: { en: 'Ignite Pre Workout', el: 'Ignite Pre Workout', ru: 'Ignite предтренировочный' },
    summary: {
      en: 'Caffeine, citrulline and beta alanine',
      el: 'Καφεΐνη, κιτρουλλίνη και β αλανίνη',
      ru: 'Кофеин, цитруллин и бета аланин',
    },
    description: {
      en: 'A full dose pre workout with 200mg caffeine, 6g citrulline malate and 3.2g beta alanine per serving. For focus and energy before heavy sessions. Contains caffeine: not recommended for children or pregnant or breastfeeding women.',
      el: 'Pre workout με 200mg καφεΐνη, 6g κιτρουλλίνη μηλική και 3,2g β αλανίνη ανά μερίδα. Περιέχει καφεΐνη: δεν συνιστάται για παιδιά, έγκυες ή θηλάζουσες.',
      ru: 'Предтренировочный комплекс: 200 мг кофеина, 6 г цитруллина малата и 3,2 г бета аланина в порции. Содержит кофеин: не рекомендуется детям, беременным и кормящим.',
    },
    usage: {
      en: 'Mix one scoop (10g) with 250ml of water 20 to 30 minutes before training. Do not exceed one serving a day or take within 6 hours of sleep.',
      el: 'Ανάμειξε μία δόση (10g) με 250ml νερό 20 έως 30 λεπτά πριν την προπόνηση. Όχι περισσότερο από μία μερίδα την ημέρα.',
      ru: 'Смешайте одну порцию (10 г) с 250 мл воды за 20 до 30 минут до тренировки. Не более одной порции в день.',
    },
    priceCents: 3290,
    sizes: [{ size: '300g' }],
    flavours: [F.blueRaspberry, F.fruitPunch, F.sourApple],
    stock: { 'Sour Apple|300g': 1 },
    defaultStock: 10,
  },
  {
    parent: 'sports-nutrition',
    category: 'pre-workout',
    slug: 'stim-free-pump',
    name: { en: 'Pump Stim Free', el: 'Pump χωρίς διεγερτικά', ru: 'Pump без стимуляторов' },
    summary: { en: 'Caffeine free pump formula', el: 'Φόρμουλα χωρίς καφεΐνη', ru: 'Формула без кофеина' },
    description: {
      en: 'All the pump, none of the caffeine. Citrulline, glycerol and nitrates for evening sessions or for stacking with your own coffee.',
      el: 'Χωρίς καφεΐνη, με κιτρουλλίνη, γλυκερόλη και νιτρικά. Ιδανικό για βραδινή προπόνηση.',
      ru: 'Без кофеина: цитруллин, глицерол и нитраты. Подходит для вечерних тренировок.',
    },
    usage: {
      en: 'Mix one scoop (12g) with 300ml of water 30 minutes before training.',
      el: 'Ανάμειξε μία δόση (12g) με 300ml νερό 30 λεπτά πριν την προπόνηση.',
      ru: 'Смешайте одну порцию (12 г) с 300 мл воды за 30 минут до тренировки.',
    },
    priceCents: 2990,
    sizes: [{ size: '360g' }],
    flavours: [F.watermelon, F.lemonLime],
    defaultStock: 7,
  },
  {
    parent: 'sports-nutrition',
    category: 'amino-acids',
    slug: 'bcaa-2-1-1',
    name: { en: 'BCAA 2:1:1', el: 'BCAA 2:1:1', ru: 'BCAA 2:1:1' },
    summary: { en: '5g BCAAs per serving, zero sugar', el: '5g BCAA ανά μερίδα, χωρίς ζάχαρη', ru: '5 г BCAA в порции, без сахара' },
    description: {
      en: 'Leucine, isoleucine and valine in the classic 2:1:1 ratio, in a light, refreshing drink you can sip through training.',
      el: 'Λευκίνη, ισολευκίνη και βαλίνη σε αναλογία 2:1:1, σε ένα δροσιστικό ρόφημα για την ώρα της προπόνησης.',
      ru: 'Лейцин, изолейцин и валин в классическом соотношении 2:1:1, лёгкий освежающий напиток.',
    },
    usage: {
      en: 'Mix one scoop (8g) with 500ml of water and sip during training.',
      el: 'Ανάμειξε μία δόση (8g) με 500ml νερό και πίνε κατά την προπόνηση.',
      ru: 'Смешайте одну порцию (8 г) с 500 мл воды и пейте во время тренировки.',
    },
    priceCents: 2490,
    sizes: [{ size: '400g' }],
    flavours: [F.tropical, F.peachTea],
    defaultStock: 9,
  },
  {
    parent: 'sports-nutrition',
    category: 'amino-acids',
    slug: 'l-glutamine',
    name: { en: 'L Glutamine', el: 'L Γλουταμίνη', ru: 'L глутамин' },
    summary: { en: '5g pure L glutamine per serving', el: '5g καθαρή L γλουταμίνη ανά μερίδα', ru: '5 г чистого L глутамина в порции' },
    description: {
      en: 'Pure fermented L glutamine powder with no added flavours. Mixes into water or your protein shake.',
      el: 'Καθαρή L γλουταμίνη σε σκόνη χωρίς πρόσθετες γεύσεις.',
      ru: 'Чистый L глутамин без добавок и ароматизаторов.',
    },
    usage: {
      en: 'Take 5g a day with water or a shake.',
      el: 'Λάβε 5g την ημέρα με νερό ή ρόφημα.',
      ru: 'Принимайте 5 г в день с водой или коктейлем.',
    },
    priceCents: 2190,
    sizes: [{ size: '500g' }],
    flavours: [F.unflavoured],
    defaultStock: 6,
  },
  {
    parent: 'sports-nutrition',
    category: 'mass-gainers',
    slug: 'mass-gainer',
    name: { en: 'Mass Gainer', el: 'Mass Gainer', ru: 'Гейнер' },
    summary: {
      en: '650 kcal and 50g protein per serving',
      el: '650 kcal και 50g πρωτεΐνης ανά μερίδα',
      ru: '650 ккал и 50 г белка в порции',
    },
    description: {
      en: 'For when eating enough is the hard part. Each serving brings 650 calories from complex carbohydrates and 50g of protein from a whey and casein blend.',
      el: 'Για όταν το να τρως αρκετά είναι το δύσκολο κομμάτι. 650 θερμίδες ανά μερίδα με σύνθετους υδατάνθρακες και 50g πρωτεΐνης.',
      ru: 'Когда трудно добрать калории: 650 ккал из сложных углеводов и 50 г белка в каждой порции.',
    },
    usage: {
      en: 'Mix two scoops (165g) with 500ml of milk. Take once a day between meals.',
      el: 'Ανάμειξε δύο δόσεις (165g) με 500ml γάλα, μία φορά την ημέρα.',
      ru: 'Смешайте две порции (165 г) с 500 мл молока, один раз в день.',
    },
    priceCents: 4990,
    sizes: [{ size: '3kg', priceCents: 4990 }, { size: '5kg', priceCents: 7490 }],
    flavours: [F.vanilla, F.chocolate],
    defaultStock: 5,
  },
  {
    parent: 'health-wellness',
    category: 'vitamins',
    slug: 'daily-multivitamin',
    name: { en: 'Daily Multivitamin', el: 'Πολυβιταμίνη Ημέρας', ru: 'Мультивитамины на каждый день' },
    summary: { en: '24 vitamins and minerals, one a day', el: '24 βιταμίνες και μέταλλα, μία την ημέρα', ru: '24 витамина и минерала, раз в день' },
    description: {
      en: 'A once a day tablet with 24 vitamins and minerals, made for active people. Food supplements should not replace a varied and balanced diet.',
      el: 'Ένα δισκίο την ημέρα με 24 βιταμίνες και μέταλλα. Τα συμπληρώματα δεν υποκαθιστούν μια ισορροπημένη διατροφή.',
      ru: 'Одна таблетка в день: 24 витамина и минерала. Добавки не заменяют разнообразное и сбалансированное питание.',
    },
    usage: {
      en: 'Take one tablet a day with food. Do not exceed the recommended daily dose.',
      el: 'Λάβε ένα δισκίο την ημέρα με φαγητό.',
      ru: 'Принимайте одну таблетку в день во время еды.',
    },
    priceCents: 1690,
    sizes: [{ size: '90 tabs' }],
    flavours: [F.none],
    defaultStock: 2,
  },
  {
    parent: 'health-wellness',
    category: 'vitamins',
    slug: 'vitamin-d3-k2',
    name: { en: 'Vitamin D3 + K2', el: 'Βιταμίνη D3 + K2', ru: 'Витамин D3 + K2' },
    summary: { en: '2000 IU D3 with 75mcg K2', el: '2000 IU D3 με 75mcg K2', ru: '2000 МЕ D3 и 75 мкг K2' },
    description: {
      en: 'Vitamin D3 with K2 in a small easy capsule. Vitamin D contributes to the normal function of the immune system and to the maintenance of normal bones and muscle function.',
      el: 'Βιταμίνη D3 με K2 σε μικρή κάψουλα. Η βιταμίνη D συμβάλλει στη φυσιολογική λειτουργία του ανοσοποιητικού και στη διατήρηση φυσιολογικών οστών.',
      ru: 'Витамин D3 и K2 в небольшой капсуле. Витамин D способствует нормальной работе иммунной системы и поддержанию здоровья костей.',
    },
    usage: {
      en: 'Take one capsule a day with a meal.',
      el: 'Λάβε μία κάψουλα την ημέρα με γεύμα.',
      ru: 'Принимайте одну капсулу в день во время еды.',
    },
    priceCents: 1490,
    sizes: [{ size: '60 caps' }],
    flavours: [F.none],
    defaultStock: 18,
  },
  {
    parent: 'health-wellness',
    category: 'omega-3',
    slug: 'omega-3-fish-oil',
    name: { en: 'Omega 3 Fish Oil', el: 'Ωμέγα 3 Ιχθυέλαιο', ru: 'Омега 3 рыбий жир' },
    summary: { en: '1000mg fish oil, 330mg EPA and DHA', el: '1000mg ιχθυέλαιο, 330mg EPA και DHA', ru: '1000 мг рыбьего жира, 330 мг EPA и DHA' },
    description: {
      en: 'Molecularly distilled fish oil softgels. EPA and DHA contribute to the normal function of the heart, with a daily intake of 250mg.',
      el: 'Κάψουλες ιχθυελαίου μοριακής απόσταξης. Τα EPA και DHA συμβάλλουν στη φυσιολογική λειτουργία της καρδιάς, με ημερήσια πρόσληψη 250mg.',
      ru: 'Рыбий жир молекулярной дистилляции. EPA и DHA способствуют нормальной работе сердца при суточном приёме 250 мг.',
    },
    usage: {
      en: 'Take two softgels a day with food.',
      el: 'Λάβε δύο κάψουλες την ημέρα με φαγητό.',
      ru: 'Принимайте две капсулы в день во время еды.',
    },
    priceCents: 1890,
    sizes: [{ size: '120 softgels' }],
    flavours: [F.none],
    defaultStock: 15,
  },
  {
    parent: 'health-wellness',
    category: 'weight-management',
    slug: 'l-carnitine-capsules',
    name: { en: 'L Carnitine Capsules', el: 'L Καρνιτίνη Κάψουλες', ru: 'L карнитин в капсулах' },
    summary: { en: '1000mg L carnitine tartrate per serving', el: '1000mg L καρνιτίνη ανά μερίδα', ru: '1000 мг L карнитина в порции' },
    description: {
      en: 'L carnitine tartrate in capsules, a simple addition to a calorie controlled diet and regular training.',
      el: 'L καρνιτίνη σε κάψουλες, ως συμπλήρωμα σε ισορροπημένη διατροφή και τακτική άσκηση.',
      ru: 'L карнитин тартрат в капсулах как дополнение к сбалансированному питанию и регулярным тренировкам.',
    },
    usage: {
      en: 'Take two capsules a day, ideally before training.',
      el: 'Λάβε δύο κάψουλες την ημέρα, ιδανικά πριν την προπόνηση.',
      ru: 'Принимайте две капсулы в день, лучше перед тренировкой.',
    },
    priceCents: 1990,
    sizes: [{ size: '90 caps' }],
    flavours: [F.none],
    defaultStock: 0,
  },
  {
    parent: 'health-wellness',
    category: 'bars-snacks',
    slug: 'protein-bar-box',
    name: { en: 'Protein Bar, Box of 12', el: 'Μπάρα Πρωτεΐνης, Κουτί 12', ru: 'Протеиновый батончик, 12 шт' },
    summary: { en: '20g protein, under 2g sugar per bar', el: '20g πρωτεΐνης, κάτω από 2g ζάχαρη', ru: '20 г белка, менее 2 г сахара' },
    description: {
      en: 'A chewy bar with a crunchy layer and 20g of protein, for the gym bag, the car or the afternoon slump. Sold by the box of twelve.',
      el: 'Μπάρα με τραγανή στρώση και 20g πρωτεΐνης, για την τσάντα του γυμναστηρίου. Πωλείται σε κουτί των δώδεκα.',
      ru: 'Батончик с хрустящим слоем и 20 г белка, удобно взять с собой. Продаётся упаковкой по 12 штук.',
    },
    usage: {
      en: 'Enjoy one bar as a snack. Per 60g bar: 210 kcal, protein 20g, sugars 1.6g.',
      el: 'Μία μπάρα ως σνακ. Ανά 60g: 210 kcal, πρωτεΐνη 20g.',
      ru: 'Один батончик как перекус. На 60 г: 210 ккал, белок 20 г.',
    },
    priceCents: 2990,
    sizes: [{ size: '12 bars' }],
    flavours: [F.chocPeanut, F.cookies],
    defaultStock: 11,
  },
  {
    parent: 'health-wellness',
    category: 'accessories',
    slug: 'aionix-shaker',
    name: { en: 'AIONIX Shaker', el: 'Σέικερ AIONIX', ru: 'Шейкер AIONIX' },
    summary: { en: '700ml, leak proof, BPA free', el: '700ml, στεγανό, χωρίς BPA', ru: '700 мл, герметичный, без BPA' },
    description: {
      en: 'Our yellow shaker with a screw lid, a flip cap that actually seals and a mixing grid for lump free shakes.',
      el: 'Το κίτρινο σέικερ μας με βιδωτό καπάκι που κλείνει σωστά και σίτα ανάμειξης.',
      ru: 'Наш жёлтый шейкер с винтовой крышкой, надёжным клапаном и сеточкой для смешивания.',
    },
    usage: {
      en: 'Dishwasher safe on the top rack. Not for hot drinks.',
      el: 'Πλένεται στο πλυντήριο πιάτων, στο πάνω ράφι. Όχι για ζεστά ροφήματα.',
      ru: 'Можно мыть в посудомоечной машине на верхней полке. Не для горячих напитков.',
    },
    priceCents: 890,
    sizes: [{ size: '700ml' }],
    flavours: [F.yellow],
    defaultStock: 40,
  },
]

async function wipe() {
  /* Child tables first. */
  await db.delete(webhookEvents)
  await db.delete(invoices)
  await db.delete(payments)
  await db.delete(orderItems)
  await db.delete(promoCodeUsage)
  await db.delete(orders)
  await db.delete(inventoryReservations)
  await db.delete(cartItems)
  await db.delete(carts)
  await db.delete(wishlistItems)
  await db.delete(wishlists)
  await db.delete(productViews)
  await db.delete(inventory)
  await db.delete(productImages)
  await db.delete(productVariants)
  await db.delete(promotions)
  await db.delete(promoCodes)
  await db.delete(products)
  await db.delete(categories)
  await db.delete(contactRequests)
  await db.delete(marketingConsents)
  await db.delete(sessions)
  await db.delete(otpCodes)
  await db.delete(addresses)
  await db.delete(users)
  await db.delete(heroBanners)
  await db.delete(deliveryOptions)
  await db.delete(settings)
}

async function main() {
  console.log('→ clearing existing data')
  await wipe()

  console.log('→ settings')
  await seedMissingSettings()

  console.log('→ categories')
  const categoryIds = new Map<string, string>() // "sports-nutrition/protein" -> uuid
  for (const [index, root] of CATEGORY_TREE.entries()) {
    const [parent] = await db
      .insert(categories)
      .values({
        slug: root.slug,
        name: root.name,
        position: index,
        seoTitle: { en: root.name.en, el: root.name.el, ru: root.name.ru },
        isActive: true,
      })
      .returning({ id: categories.id })
    categoryIds.set(root.slug, parent.id)

    for (const [childIndex, child] of root.children.entries()) {
      const [sub] = await db
        .insert(categories)
        .values({
          parentId: parent.id,
          slug: child.slug,
          name: child.name,
          position: childIndex,
          imageUrl: categoryArtUrl(`${root.slug}-${child.slug}`),
          isActive: true,
        })
        .returning({ id: categories.id })
      categoryIds.set(`${root.slug}/${child.slug}`, sub.id)
    }
  }
  console.log(`  ${categoryIds.size} categories`)

  console.log('→ products, variants and stock')
  let variantCount = 0
  let unitCount = 0

  for (const spec of PRODUCTS) {
    const categoryId = categoryIds.get(`${spec.parent}/${spec.category}`)
    if (!categoryId) throw new Error(`No category ${spec.parent}/${spec.category}`)

    const [product] = await db
      .insert(products)
      .values({
        categoryId,
        slug: spec.slug,
        name: spec.name,
        summary: spec.summary,
        description: spec.description,
        priceCents: spec.priceCents,
        salePriceCents: spec.salePriceCents ?? null,
        seoTitle: { en: spec.name.en, el: spec.name.el, ru: spec.name.ru },
        seoDescription: {
          en: spec.summary.en,
          el: spec.summary.el,
          ru: spec.summary.ru,
        },
        /* "Nutrition & usage" on the product page. */
        sizeGuide: spec.usage,
        isActive: true,
        publishedAt: new Date(),
      })
      .returning({ id: products.id })

    /* Front and back, from public/products: a photograph if the shop has
       supplied one, otherwise the drawn pack. See scripts/generate-art.ts. */
    await db.insert(productImages).values([
      {
        productId: product.id,
        url: artUrl(spec.slug),
        alt: { en: spec.name.en, el: spec.name.el, ru: spec.name.ru },
        width: 900,
        height: 1200,
        position: 0,
      },
      {
        productId: product.id,
        url: artUrl(spec.slug, true),
        alt: {
          en: `${spec.name.en}, back of pack`,
          el: `${spec.name.el}, πίσω όψη`,
          ru: `${spec.name.ru}, обратная сторона`,
        },
        width: 900,
        height: 1200,
        position: 1,
      },
    ])

    let position = 0

    for (const color of spec.flavours) {
      for (const { size, priceCents, salePriceCents } of spec.sizes) {
        const [variant] = await db
          .insert(productVariants)
          .values({
            productId: product.id,
            sku: `AX-${spec.slug.slice(0, 12).toUpperCase().replace(/[^A-Z0-9]/g, '')}-${color.name.en.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase()}-${size.replace(/[^A-Za-z0-9.]/g, '').toUpperCase()}`,
            size,
            colorName: color.name,
            colorHex: color.hex,
            /* Only where the size is priced differently from the product. */
            priceCentsOverride: priceCents && priceCents !== spec.priceCents ? priceCents : null,
            salePriceCentsOverride: salePriceCents ?? null,
            position: position++,
            isActive: true,
          })
          .returning({ id: productVariants.id })

        const onHand =
          spec.stock?.[`${color.name.en}|${size}`] ?? spec.stock?.[size] ?? spec.defaultStock ?? 5
        await db.insert(inventory).values({
          variantId: variant.id,
          onHand,
          reserved: 0,
          lowStockThreshold: 3,
        })

        variantCount++
        unitCount += onHand
      }
    }
  }
  console.log(`  ${PRODUCTS.length} products, ${variantCount} variants, ${unitCount} units`)

  console.log('→ delivery options')
  await db.insert(deliveryOptions).values([
    {
      kind: 'PICKUP',
      name: { en: 'Collect in store, Larnaca', el: 'Παραλαβή από το κατάστημα, Λάρνακα', ru: 'Самовывоз, Ларнака' },
      description: {
        en: 'Ready the same afternoon on weekdays.',
        el: 'Έτοιμο το ίδιο απόγευμα τις εργάσιμες.',
        ru: 'Готово в тот же день по будням.',
      },
      priceCents: 0,
      minDays: 0,
      maxDays: 1,
      countries: ['CY'],
      position: 0,
      isActive: true,
    },
    {
      kind: 'SHIPPING',
      name: { en: 'Home delivery', el: 'Παράδοση στο σπίτι', ru: 'Доставка на дом' },
      description: {
        en: 'Anywhere in Cyprus, 2 to 4 working days.',
        el: 'Σε όλη την Κύπρο, 2 έως 4 εργάσιμες.',
        ru: 'По всему Кипру, от 2 до 4 рабочих дней.',
      },
      priceCents: 500,
      minDays: 2,
      maxDays: 4,
      countries: ['CY'],
      position: 1,
      isActive: true,
    },
  ])

  console.log('→ promotions and a promo code')
  /* Scoped to a SUBcategory on purpose: it proves the category-ancestry walk
     (a whey filed under Sports Nutrition, Protein is discounted, its siblings
     under Sports Nutrition are not), and it leaves that listing showing a
     realistic mix of full price and reduced product. */
  const proteinId = categoryIds.get('sports-nutrition/protein')!
  await db.insert(promotions).values([
    {
      name: '15% off protein',
      scope: 'CATEGORY',
      categoryId: proteinId,
      discountType: 'PERCENTAGE',
      discountValue: 15,
      badgeText: {
        en: '15% OFF ALL PROTEIN',
        el: '-15% ΣΕ ΟΛΕΣ ΤΙΣ ΠΡΩΤΕΪΝΕΣ',
        ru: '-15% НА ВЕСЬ ПРОТЕИН',
      },
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      showOnHomepage: true,
      priority: 10,
      isActive: true,
    },
  ])

  await db.insert(promoCodes).values([
    {
      code: 'WELCOME10',
      discountType: 'PERCENTAGE',
      discountValue: 10,
      minOrderCents: 3000,
      maxUses: 500,
      maxUsesPerUser: 1,
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      isActive: true,
    },
    {
      code: 'EXPIRED20',
      discountType: 'PERCENTAGE',
      discountValue: 20,
      startsAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      isActive: true,
    },
  ])

  console.log('→ hero banner')
  await db.insert(heroBanners).values({
    title: { en: 'Fuel your performance', el: 'Δύναμη σε κάθε προπόνηση', ru: 'Энергия для результата' },
    subtitle: {
      en: 'Protein, creatine, pre workout and vitamins. Stocked in Larnaca, delivered across Cyprus.',
      el: 'Πρωτεΐνες, κρεατίνη, pre workout και βιταμίνες. Στη Λάρνακα, με παράδοση σε όλη την Κύπρο.',
      ru: 'Протеин, креатин, предтренировочные комплексы и витамины. В Ларнаке, с доставкой по всему Кипру.',
    },
    /* No text in the hero artwork: the headline is a real <h1> over the top of
       it, and a label baked into the image collides with it. Real photography
       replaces these in the admin panel without a deploy. */
    imageUrl: heroArtUrl('hero') ?? heroPlaceholder(1600, 1000),
    mobileImageUrl: heroArtUrl('hero-mobile') ?? heroPlaceholder(800, 1200),
    videoUrl: heroVideoUrl('hero'),
    mobileVideoUrl: heroVideoUrl('hero-mobile'),
    primaryCtaLabel: { en: 'Shop Sports Nutrition', el: 'Αθλητική Διατροφή', ru: 'Спортивное питание' },
    primaryCtaHref: '/sports-nutrition',
    secondaryCtaLabel: { en: 'Shop Health & Wellness', el: 'Υγεία & Ευεξία', ru: 'Здоровье' },
    secondaryCtaHref: '/health-wellness',
    textAlign: 'left',
    position: 0,
    isActive: true,
  })

  console.log('→ admin and test accounts')
  /* Seed credentials are for local development only. The README says to change
     them before any deployment, and the login is rate-limited regardless. */
  /* A known password is fine on a laptop and unacceptable anywhere else, so
     outside development the seed insists on being given one. */
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error(
      'Refusing to seed an admin with a default password. Set SEED_ADMIN_PASSWORD.',
    )
  }
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-in-production'
  /* The demo customer exists only on a local copy, never with the real
     admin password on a live shop. */
  const demoCustomer = process.env.NODE_ENV !== 'production' && !process.env.SEED_ADMIN_PASSWORD
  await db.insert(users).values([
    {
      email: 'admin@example.com',
      phone: '+35799000001',
      passwordHash: await hashPassword(adminPassword),
      firstName: 'Store',
      lastName: 'Owner',
      role: 'SUPER_ADMIN' as const,
      emailVerifiedAt: new Date(),
    },
    {
      email: 'customer@example.com',
      phone: '+35799000002',
      passwordHash: await hashPassword(adminPassword),
      firstName: 'Elena',
      lastName: 'Georgiou',
      role: 'CUSTOMER' as const,
      emailVerifiedAt: new Date(),
    },
  ].filter((u) => u.role !== 'CUSTOMER' || demoCustomer))

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(products)

  console.log(`\n✓ seeded — ${count} products live`)
  console.log(`  admin:    admin@example.com${process.env.SEED_ADMIN_PASSWORD ? ' (password from SEED_ADMIN_PASSWORD)' : ` / ${adminPassword}`}`)
  if (demoCustomer) console.log(`  customer: customer@example.com / ${adminPassword}`)
  console.log(`  promo code: WELCOME10 (10% off over €30)\n`)
}

main()
  .catch((err) => {
    console.error('✗ seed failed:', err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
