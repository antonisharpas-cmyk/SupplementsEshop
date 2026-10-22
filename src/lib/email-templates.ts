/* ============================================================================
 * Every email the shop sends, in one place.
 *
 * Each template has built-in words in English, Greek and Russian (below).
 * The owner can change any of them in Admin → Marketing & Emails; the
 * changes live in the `email_templates` table and override the built-in
 * text language by language. Anything never edited uses the text here.
 *
 * A template is words and {{variables}} — nothing else. There is no code in
 * a template, no HTML, no expressions: `{{customer_name}}` is replaced by the
 * customer's first name, HTML-escaped; an unknown `{{thing}}` is refused
 * when saving. So an edited template cannot run anything, cannot inject
 * markup, and cannot leak another variable.
 *
 * Format of a body:
 *   · blank line = new paragraph; single line break = line break
 *   · a paragraph that is only a block variable ({{bag_items}}, {{code}} …)
 *     becomes that block — the product list, the big code, the transcript
 *   · a paragraph using a variable that has no value this time (e.g. a
 *     tracking number the courier did not give) is left out altogether
 *
 * Categories:
 *   essential  — codes, order and account messages, the support transcript.
 *                Sent to whoever they concern. `required` ones cannot be
 *                switched off.
 *   lifecycle  — welcome, back in stock, review request: sent because of
 *                something the customer did; can be switched off.
 *   marketing  — abandoned bag, newsletter: only with marketing consent,
 *                always with an unsubscribe link, subject to the frequency
 *                limit.
 * ========================================================================== */

import { BRAND } from '@/config/brand'

export type Locale = 'en' | 'el' | 'ru'
export const EMAIL_LOCALES: Locale[] = ['en', 'el', 'ru']
export type EmailCategory = 'essential' | 'lifecycle' | 'marketing'

export type TemplateKey =
  | 'auth_verification'
  | 'auth_existing_account'
  | 'auth_password_reset'
  | 'security_password_changed'
  | 'welcome'
  | 'newsletter_confirm'
  | 'newsletter_welcome'
  | 'abandoned_bag'
  | 'abandoned_bag_followup'
  | 'back_in_stock'
  | 'review_request'
  | 'order_received'
  | 'payment_confirmed'
  | 'order_confirmed'
  | 'order_preparing'
  | 'order_ready_for_pickup'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_completed'
  | 'order_cancelled'
  | 'support_new'
  | 'order_new_staff'
  | 'support_transcript'

/* --------------------------------------------------------- variables --- */

export type Item = { name: string; image?: string | null; detail?: string | null; quantity: number; price: string }
export type TranscriptLine = { from: string; at: string; text: string; customer: boolean }
export type ProductBlock = { name: string; image?: string | null; detail?: string | null; price?: string | null }

export type VarValue = string | number | null | undefined | Item[] | TranscriptLine[] | ProductBlock
export type Vars = Record<string, VarValue>

type VarDef = { label: string; sample: VarValue; block?: 'code' | 'items' | 'transcript' | 'quote' | 'product' }

const SAMPLE_IMAGE = '/products/whey-protein-isolate.svg'

/** Every variable any template may use, with what it means and a sample for
 *  previews. Templates list which of these they accept. */
export const VARIABLES: Record<string, VarDef> = {
  customer_name: { label: 'Customer’s first name', sample: 'Maria' },
  shop_url: { label: 'Link to the shop', sample: 'https://aionix.example/en' },
  code: { label: 'The 6-digit code (shown large)', sample: '482913', block: 'code' },
  minutes: { label: 'Minutes the code is valid', sample: 10 },
  sign_in_url: { label: 'Link to sign in', sample: 'https://aionix.example/en/sign-in' },
  confirm_url: { label: 'Link that confirms the subscription', sample: 'https://aionix.example/en/newsletter/confirm?token=…' },
  newsletter_note: { label: 'A line confirming new-arrival emails, only when they signed up', sample: 'You’re also on the list for new arrivals.' },
  bag_items: {
    label: 'The products in the bag (image, name, flavour, size, quantity, price)',
    sample: [
      { name: 'Whey Protein Isolate', image: SAMPLE_IMAGE, detail: 'Chocolate · 2kg', quantity: 1, price: '€64.90' },
      { name: 'Creatine Monohydrate', image: null, detail: 'Unflavoured · 500g', quantity: 2, price: '€49.80' },
    ],
    block: 'items',
  },
  bag_url: { label: 'Link back to the bag', sample: 'https://aionix.example/en/cart' },
  product_name: { label: 'Product name', sample: 'Whey Protein Isolate' },
  product: {
    label: 'The product (image, name, flavour and size)',
    sample: { name: 'Whey Protein Isolate', image: SAMPLE_IMAGE, detail: 'Chocolate · 2kg', price: '€64.90' },
    block: 'product',
  },
  product_url: { label: 'Link to the product', sample: 'https://aionix.example/en/products/whey-protein-isolate' },
  order_number: { label: 'Order number', sample: 'SF-7K2M9QX4' },
  order_total: { label: 'Order total', sample: '€125.00' },
  order_items: {
    label: 'The products in the order',
    sample: [{ name: 'Whey Protein Isolate', image: SAMPLE_IMAGE, detail: 'Chocolate · 2kg', quantity: 1, price: '€64.90' }],
    block: 'items',
  },
  order_url: { label: 'Link to the order', sample: 'https://aionix.example/en/account/orders/SF-7K2M9QX4' },
  tracking_number: { label: 'Courier tracking number, left out when there is none', sample: 'CY123456789' },
  tracking_url: { label: 'Courier tracking link, left out when there is none', sample: 'https://courier.example/track/CY123456789' },
  delivery_estimate: { label: 'Estimated delivery, when known', sample: '2–4 working days' },
  pickup_address: { label: 'Store address for collection', sample: 'AIONIX store, Larnaca' },
  opening_hours: { label: 'Store opening hours', sample: BRAND.contact.openingHours },
  refund_amount: { label: 'Refunded amount, when there is one', sample: '€55.00' },
  conversation_date: { label: 'When the conversation started', sample: '30 Sept 2026, 12:53' },
  transcript: {
    label: 'The whole conversation',
    sample: [
      { from: 'You', at: '12:53', text: 'Which flavour of the whey isolate mixes best with water?', customer: true },
      { from: 'AIONIX Customer Service', at: '12:55', text: 'Chocolate is the favourite, it mixes smooth with just water.', customer: false },
    ],
    block: 'transcript',
  },
  contact_url: { label: 'Link to Help & contact', sample: 'https://aionix.example/en/contact' },
  customer_email: { label: 'Customer’s email (staff emails)', sample: 'maria@example.com' },
  started_at: { label: 'When it started (staff emails)', sample: '30 Sept 2026, 12:53' },
  page: { label: 'Page they were on (staff emails)', sample: '/en/products/whey-protein-isolate' },
  message: { label: 'Their first message (staff emails)', sample: 'Which flavour of the whey isolate mixes best with water?', block: 'quote' },
  admin_url: { label: 'Link to it in the admin (staff emails)', sample: 'https://aionix.example/admin/support?c=…' },
  payment_method: { label: 'How the order is paid (staff emails)', sample: 'Card, paid' },
  delivery: { label: 'Delivery or collection, with the address (staff emails)', sample: 'Delivery to 12 Ermou Street, 6021 Larnaca' },
  customer_phone: { label: 'Customer’s phone (staff emails)', sample: '+357 99123456' },
}

/* --------------------------------------------------------- templates --- */

type Words = { subject: string; body: string; cta?: string }

export type TemplateDef = {
  key: TemplateKey
  name: string
  category: EmailCategory
  /** Cannot be switched off (codes, orders, security, transcripts). */
  required: boolean
  /** Enabled until the owner says otherwise. */
  defaultEnabled: boolean
  /** When it is sent, in words, for the admin list. */
  trigger: string
  /** Minutes after the trigger; editable within [min, max]. */
  timing?: { minutes: number; min: number; max: number; label: string }
  /** Staff-facing: always English, never to customers. */
  internal?: boolean
  /** Which variable is the button's link. */
  ctaUrl?: string
  variables: string[]
  /** Something the admin should know, e.g. "sends once checkout exists". */
  note?: string
  words: Record<Locale, Words>
}

const ORDER_NOTE = 'Sends automatically once checkout and orders are switched on.'

export const TEMPLATES: TemplateDef[] = [
  /* ------------------------------------------------------ account --- */
  {
    key: 'auth_verification',
    name: 'Email verification',
    category: 'essential',
    required: true,
    defaultEnabled: true,
    trigger: 'Registration',
    variables: ['code', 'minutes', 'customer_name'],
    words: {
      en: {
        subject: '{{code}} is your AIONIX verification code',
        body: 'Your verification code is\n\n{{code}}\n\nEnter it to finish creating your account. It expires in {{minutes}} minutes.\n\nIf you did not try to create an account, you can ignore this email, nothing has been created.',
      },
      el: {
        subject: '{{code}}: ο κωδικός επιβεβαίωσης για το AIONIX',
        body: 'Ο κωδικός επιβεβαίωσής σου είναι\n\n{{code}}\n\nΒάλε τον για να ολοκληρώσεις τη δημιουργία λογαριασμού. Λήγει σε {{minutes}} λεπτά.\n\nΑν δεν προσπάθησες να δημιουργήσεις λογαριασμό, αγνόησε αυτό το email, δεν δημιουργήθηκε τίποτα.',
      },
      ru: {
        subject: '{{code}}, ваш код подтверждения AIONIX',
        body: 'Ваш код подтверждения\n\n{{code}}\n\nВведите его, чтобы завершить создание аккаунта. Код действует {{minutes}} минут.\n\nЕсли вы не создавали аккаунт, просто проигнорируйте это письмо, ничего создано не было.',
      },
    },
  },
  {
    key: 'auth_existing_account',
    name: 'Registration with an existing email',
    category: 'essential',
    required: true,
    defaultEnabled: true,
    trigger: 'Someone registers with an email that already has an account',
    ctaUrl: 'sign_in_url',
    variables: ['customer_name', 'sign_in_url', 'contact_url'],
    note: 'Sent instead of a code, so the registration form never reveals whether an email already has an account.',
    words: {
      en: {
        subject: 'Your AIONIX account',
        body: 'Hi {{customer_name}},\n\nSomeone, probably you, just tried to create an AIONIX account with this email address. You already have one, so nothing new was created.\n\nIf it was you, simply sign in. If it wasn’t, you can ignore this email; your account is unchanged.',
        cta: 'Sign in',
      },
      el: {
        subject: 'Ο λογαριασμός σου στο AIONIX',
        body: 'Γεια σου {{customer_name}},\n\nΚάποιος, μάλλον εσύ, προσπάθησε να δημιουργήσει λογαριασμό AIONIX με αυτό το email. Έχεις ήδη λογαριασμό, οπότε δεν δημιουργήθηκε νέος.\n\nΑν ήσουν εσύ, απλώς συνδέσου. Αν όχι, αγνόησε αυτό το email· ο λογαριασμός σου δεν άλλαξε.',
        cta: 'Σύνδεση',
      },
      ru: {
        subject: 'Ваш аккаунт AIONIX',
        body: 'Здравствуйте, {{customer_name}}!\n\nКто-то, скорее всего вы, попытался создать аккаунт AIONIX с этим адресом. Аккаунт у вас уже есть, поэтому новый не создан.\n\nЕсли это были вы, просто войдите. Если нет, проигнорируйте письмо, ваш аккаунт не изменился.',
        cta: 'Войти',
      },
    },
  },
  {
    key: 'auth_password_reset',
    name: 'Password reset',
    category: 'essential',
    required: true,
    defaultEnabled: true,
    trigger: 'Password reset requested',
    variables: ['code', 'minutes', 'customer_name'],
    words: {
      en: {
        subject: 'Reset your AIONIX password',
        body: 'Your password reset code is\n\n{{code}}\n\nIt expires in {{minutes}} minutes and can be used once.\n\nIf you did not ask to reset your password, ignore this email and your password stays as it is.',
      },
      el: {
        subject: 'Επαναφορά κωδικού AIONIX',
        body: 'Ο κωδικός επαναφοράς είναι\n\n{{code}}\n\nΛήγει σε {{minutes}} λεπτά και χρησιμοποιείται μία φορά.\n\nΑν δεν ζήτησες επαναφορά, αγνόησε αυτό το email και ο κωδικός σου μένει ίδιος.',
      },
      ru: {
        subject: 'Сброс пароля AIONIX',
        body: 'Код для сброса пароля\n\n{{code}}\n\nОн действует {{minutes}} минут и может быть использован один раз.\n\nЕсли вы не запрашивали сброс, проигнорируйте письмо, пароль останется прежним.',
      },
    },
  },
  {
    key: 'security_password_changed',
    name: 'Password changed',
    category: 'essential',
    required: true,
    defaultEnabled: true,
    trigger: 'Password changed',
    ctaUrl: 'contact_url',
    variables: ['customer_name', 'contact_url'],
    words: {
      en: {
        subject: 'Your AIONIX password was changed',
        body: 'Hi {{customer_name}},\n\nThe password for your AIONIX account was just changed, and every other device was signed out.\n\nIf this was you, there is nothing to do. If it wasn’t, contact us straight away.',
        cta: 'Contact us',
      },
      el: {
        subject: 'Ο κωδικός σου στο AIONIX άλλαξε',
        body: 'Γεια σου {{customer_name}},\n\nΟ κωδικός του λογαριασμού σου μόλις άλλαξε και αποσυνδέθηκαν όλες οι άλλες συσκευές.\n\nΑν ήσουν εσύ, δεν χρειάζεται να κάνεις τίποτα. Αν όχι, επικοινώνησε αμέσως μαζί μας.',
        cta: 'Επικοινωνία',
      },
      ru: {
        subject: 'Пароль AIONIX изменён',
        body: 'Здравствуйте, {{customer_name}}!\n\nПароль вашего аккаунта AIONIX только что изменён, на всех других устройствах выполнен выход.\n\nЕсли это были вы, ничего делать не нужно. Если нет, немедленно свяжитесь с нами.',
        cta: 'Связаться с нами',
      },
    },
  },
  {
    key: 'welcome',
    name: 'Welcome',
    category: 'lifecycle',
    required: false,
    defaultEnabled: true,
    trigger: 'Email verified',
    ctaUrl: 'shop_url',
    variables: ['customer_name', 'shop_url', 'newsletter_note'],
    words: {
      en: {
        subject: 'Welcome to AIONIX',
        body: 'Hi {{customer_name}},\n\nWelcome to AIONIX. Your account is ready, your bag, your details and any conversation with Customer Service are now in one place.\n\n{{newsletter_note}}\n\nWe’re glad you’re here.',
        cta: 'Shop now',
      },
      el: {
        subject: 'Καλώς ήρθες στο AIONIX',
        body: 'Γεια σου {{customer_name}},\n\nΚαλώς ήρθες στο AIONIX. Ο λογαριασμός σου είναι έτοιμος, η τσάντα σου, τα στοιχεία σου και οι συνομιλίες με την Εξυπηρέτηση Πελατών είναι πλέον σε ένα μέρος.\n\n{{newsletter_note}}\n\nΧαιρόμαστε που είσαι εδώ.',
        cta: 'Αγόρασε τώρα',
      },
      ru: {
        subject: 'Добро пожаловать в AIONIX',
        body: 'Здравствуйте, {{customer_name}}!\n\nДобро пожаловать в AIONIX. Ваш аккаунт готов, корзина, данные и переписка со службой поддержки теперь в одном месте.\n\n{{newsletter_note}}\n\nМы рады, что вы с нами.',
        cta: 'За покупками',
      },
    },
  },

  /* --------------------------------------------------- newsletter --- */
  {
    key: 'newsletter_confirm',
    name: 'Newsletter: confirm subscription',
    category: 'essential',
    required: true,
    defaultEnabled: true,
    trigger: 'Newsletter sign-up',
    ctaUrl: 'confirm_url',
    variables: ['customer_name', 'confirm_url'],
    note: 'The double opt-in step: nobody receives marketing until they click this.',
    words: {
      en: {
        subject: 'Confirm your AIONIX subscription',
        body: 'Hi {{customer_name}},\n\nPlease confirm you want emails about new arrivals and selected offers.\n\nIf this wasn’t you, ignore this email, you won’t be added.',
        cta: 'Confirm my subscription',
      },
      el: {
        subject: 'Επιβεβαίωσε την εγγραφή σου στο AIONIX',
        body: 'Γεια σου {{customer_name}},\n\nΕπιβεβαίωσε ότι θέλεις να λαμβάνεις email για νέες αφίξεις και επιλεγμένες προσφορές.\n\nΑν δεν ήσουν εσύ, αγνόησε αυτό το email, δεν θα προστεθείς.',
        cta: 'Επιβεβαίωση εγγραφής',
      },
      ru: {
        subject: 'Подтвердите подписку на AIONIX',
        body: 'Здравствуйте, {{customer_name}}!\n\nПодтвердите, что хотите получать письма о новинках и избранных предложениях.\n\nЕсли это были не вы, просто проигнорируйте письмо, вас не добавят.',
        cta: 'Подтвердить подписку',
      },
    },
  },
  {
    key: 'newsletter_welcome',
    name: 'Newsletter: welcome',
    category: 'marketing',
    required: false,
    defaultEnabled: true,
    trigger: 'Subscription confirmed',
    ctaUrl: 'shop_url',
    variables: ['customer_name', 'shop_url'],
    words: {
      en: {
        subject: 'You’re on the AIONIX list',
        body: 'Hi {{customer_name}},\n\nThanks for joining. You’ll hear from us first when new products land.',
        cta: 'See what’s new',
      },
      el: {
        subject: 'Είσαι στη λίστα του AIONIX',
        body: 'Γεια σου {{customer_name}},\n\nΕυχαριστούμε που εγγράφηκες. Θα μαθαίνεις πρώτος όταν έρχονται νέα προϊόντα.',
        cta: 'Δες τι νέο υπάρχει',
      },
      ru: {
        subject: 'Вы в списке AIONIX',
        body: 'Здравствуйте, {{customer_name}}!\n\nСпасибо за подписку. Вы первыми узнаете о новых поступлениях.',
        cta: 'Смотреть новинки',
      },
    },
  },

  /* ------------------------------------------------------ the bag --- */
  {
    key: 'abandoned_bag',
    name: 'Abandoned bag',
    category: 'marketing',
    required: false,
    defaultEnabled: true,
    trigger: 'Bag left without checking out',
    timing: { minutes: 240, min: 60, max: 2880, label: 'after the last change to the bag' },
    ctaUrl: 'bag_url',
    variables: ['customer_name', 'bag_items', 'bag_url'],
    note: 'Only to signed-in customers who agreed to marketing emails, and only while the products are still available.',
    words: {
      en: {
        subject: 'You left something behind',
        body: 'Hi {{customer_name}},\n\nYou left a few products in your bag. They’re still here if you want them.\n\n{{bag_items}}',
        cta: 'Return to my bag',
      },
      el: {
        subject: 'Ξέχασες κάτι',
        body: 'Γεια σου {{customer_name}},\n\nΆφησες μερικά προϊόντα στην τσάντα σου. Είναι ακόμα εδώ, αν τα θέλεις.\n\n{{bag_items}}',
        cta: 'Επιστροφή στην τσάντα',
      },
      ru: {
        subject: 'Вы кое-что забыли',
        body: 'Здравствуйте, {{customer_name}}!\n\nВ вашей корзине остались товары. Они всё ещё ждут вас.\n\n{{bag_items}}',
        cta: 'Вернуться в корзину',
      },
    },
  },
  {
    key: 'abandoned_bag_followup',
    name: 'Abandoned bag, follow-up',
    category: 'marketing',
    required: false,
    defaultEnabled: false,
    trigger: 'Still no purchase after the first reminder',
    timing: { minutes: 1440, min: 360, max: 10080, label: 'after the last change to the bag' },
    ctaUrl: 'bag_url',
    variables: ['customer_name', 'bag_items', 'bag_url'],
    note: 'Only after the first reminder was sent, and only if nothing has changed or been bought since.',
    words: {
      en: {
        subject: 'Still thinking about it?',
        body: 'Hi {{customer_name}},\n\nYour products are still in your bag, but popular flavours don’t always wait.\n\n{{bag_items}}',
        cta: 'Return to my bag',
      },
      el: {
        subject: 'Το σκέφτεσαι ακόμα;',
        body: 'Γεια σου {{customer_name}},\n\nΤα προϊόντα σου είναι ακόμα στην τσάντα, αλλά οι δημοφιλείς γεύσεις δεν περιμένουν πάντα.\n\n{{bag_items}}',
        cta: 'Επιστροφή στην τσάντα',
      },
      ru: {
        subject: 'Всё ещё думаете?',
        body: 'Здравствуйте, {{customer_name}}!\n\nВаши товары всё ещё в корзине, но популярные вкусы не всегда ждут.\n\n{{bag_items}}',
        cta: 'Вернуться в корзину',
      },
    },
  },
  {
    key: 'back_in_stock',
    name: 'Back in stock',
    category: 'lifecycle',
    required: false,
    defaultEnabled: true,
    trigger: 'A product someone asked about is available again',
    ctaUrl: 'product_url',
    variables: ['customer_name', 'product', 'product_name', 'product_url'],
    note: 'Ready for “Notify me when available”; nothing sends until that button exists on product pages.',
    words: {
      en: { subject: 'It’s back: {{product_name}}', body: 'Good news, the product you asked about is available again.\n\n{{product}}', cta: 'Shop now' },
      el: { subject: 'Επέστρεψε: {{product_name}}', body: 'Καλά νέα, το προϊόν που ζήτησες είναι ξανά διαθέσιμο.\n\n{{product}}', cta: 'Αγόρασε τώρα' },
      ru: { subject: 'Снова в наличии: {{product_name}}', body: 'Хорошие новости: товар, о котором вы спрашивали, снова в наличии.\n\n{{product}}', cta: 'Купить' },
    },
  },
  {
    key: 'review_request',
    name: 'Review request',
    category: 'lifecycle',
    required: false,
    defaultEnabled: false,
    trigger: 'Order delivered',
    timing: { minutes: 7200, min: 4320, max: 10080, label: 'after delivery' },
    ctaUrl: 'order_url',
    variables: ['customer_name', 'order_number', 'order_url'],
    note: 'Off until reviews exist on the site; the button links to the order meanwhile.',
    words: {
      en: {
        subject: 'How did you like your AIONIX order?',
        body: 'Hi {{customer_name}},\n\nYour order {{order_number}} arrived a few days ago. We hope everything fits and feels right.\n\nIf anything isn’t, reply to this email and we’ll sort it out.',
        cta: 'View my order',
      },
      el: {
        subject: 'Σου άρεσε η παραγγελία σου από το AIONIX;',
        body: 'Γεια σου {{customer_name}},\n\nΗ παραγγελία σου {{order_number}} έφτασε πριν από λίγες μέρες. Ελπίζουμε να σου κάθονται όλα τέλεια.\n\nΑν κάτι δεν είναι σωστό, απάντησε σε αυτό το email και θα το τακτοποιήσουμε.',
        cta: 'Η παραγγελία μου',
      },
      ru: {
        subject: 'Как вам заказ AIONIX?',
        body: 'Здравствуйте, {{customer_name}}!\n\nВаш заказ {{order_number}} пришёл несколько дней назад. Надеемся, всё подошло.\n\nЕсли что-то не так, ответьте на это письмо, мы всё решим.',
        cta: 'Мой заказ',
      },
    },
  },

  /* ------------------------------------------------------- orders --- */
  ...orderTemplates(),

  /* ------------------------------------------- customer service --- */
  {
    key: 'support_new',
    name: 'Customer service: new conversation (to staff)',
    category: 'essential',
    required: true,
    defaultEnabled: true,
    internal: true,
    trigger: 'A customer starts a chat',
    ctaUrl: 'admin_url',
    variables: ['customer_name', 'customer_email', 'started_at', 'page', 'message', 'admin_url'],
    words: {
      en: {
        subject: 'New customer support conversation',
        body: 'A customer started a conversation.\n\nName: {{customer_name}}\nEmail: {{customer_email}}\nStarted: {{started_at}}\n\nPage: {{page}}\n\n{{message}}',
        cta: 'Open in admin',
      },
      el: { subject: '', body: '' },
      ru: { subject: '', body: '' },
    },
  },
  {
    key: 'order_new_staff',
    name: 'New order (to staff)',
    category: 'essential',
    required: false,
    defaultEnabled: true,
    internal: true,
    trigger: 'A customer places an order',
    ctaUrl: 'admin_url',
    variables: ['order_number', 'order_total', 'order_items', 'customer_name', 'customer_email', 'customer_phone', 'payment_method', 'delivery', 'admin_url'],
    words: {
      en: {
        subject: 'New order {{order_number}}, {{order_total}}',
        body: 'A new order has come in.\n\nOrder: {{order_number}}\nTotal: {{order_total}}\nPayment: {{payment_method}}\n\nCustomer: {{customer_name}}\nEmail: {{customer_email}}\nPhone: {{customer_phone}}\n\n{{delivery}}\n\n{{order_items}}',
        cta: 'Open the order',
      },
      el: { subject: '', body: '' },
      ru: { subject: '', body: '' },
    },
  },
  {
    key: 'support_transcript',
    name: 'Customer service: conversation transcript',
    category: 'essential',
    required: true,
    defaultEnabled: true,
    trigger: 'A conversation closes',
    variables: ['customer_name', 'conversation_date', 'transcript', 'contact_url'],
    words: {
      en: {
        subject: 'Your AIONIX Customer Service conversation',
        body: 'Here is a copy of your conversation with us.\n\nDate: {{conversation_date}}\n\n{{transcript}}\n\nNeed anything else? Start a new conversation any time on our site: {{contact_url}}',
      },
      el: {
        subject: 'Η συνομιλία σου με την Εξυπηρέτηση Πελατών AIONIX',
        body: 'Ακολουθεί αντίγραφο της συνομιλίας σου μαζί μας.\n\nΗμερομηνία: {{conversation_date}}\n\n{{transcript}}\n\nΧρειάζεσαι κάτι ακόμα; Ξεκίνα νέα συνομιλία στο site μας: {{contact_url}}',
      },
      ru: {
        subject: 'Ваш разговор со службой поддержки AIONIX',
        body: 'Вот копия вашего разговора с нами.\n\nДата: {{conversation_date}}\n\n{{transcript}}\n\nНужно что-то ещё? Начните новый разговор на нашем сайте: {{contact_url}}',
      },
    },
  },
]

function orderTemplates(): TemplateDef[] {
  const base = (key: TemplateKey, name: string, trigger: string, variables: string[], words: Record<Locale, Words>, extra: Partial<TemplateDef> = {}): TemplateDef => ({
    key,
    name,
    category: 'essential',
    required: true,
    defaultEnabled: true,
    trigger,
    ctaUrl: 'order_url',
    variables: ['customer_name', 'order_number', 'order_url', ...variables],
    note: ORDER_NOTE,
    words,
    ...extra,
  })
  const view = { en: 'View my order', el: 'Η παραγγελία μου', ru: 'Мой заказ' }
  return [
    base('order_received', 'Order received', 'Order placed', ['order_total', 'order_items'], {
      en: { subject: 'Order {{order_number}} received', body: 'Thanks {{customer_name}}, we have your order.\n\nOrder: {{order_number}}\nTotal: {{order_total}}\n\n{{order_items}}\n\nWe’ll email you again as it moves along.', cta: view.en },
      el: { subject: 'Λάβαμε την παραγγελία {{order_number}}', body: 'Ευχαριστούμε {{customer_name}}, λάβαμε την παραγγελία σου.\n\nΠαραγγελία: {{order_number}}\nΣύνολο: {{order_total}}\n\n{{order_items}}\n\nΘα σε ενημερώνουμε σε κάθε βήμα.', cta: view.el },
      ru: { subject: 'Заказ {{order_number}} получен', body: 'Спасибо, {{customer_name}}, мы получили ваш заказ.\n\nЗаказ: {{order_number}}\nСумма: {{order_total}}\n\n{{order_items}}\n\nМы напишем, когда он будет продвигаться.', cta: view.ru },
    }),
    /* For card orders this is the only confirmation: nothing is sent before the payment succeeds. */
    base('payment_confirmed', 'Payment confirmed', 'Payment succeeded', ['order_total', 'order_items'], {
      en: { subject: 'Order {{order_number}}: payment received', body: 'Thanks {{customer_name}}, your payment of {{order_total}} went through and we have your order.\n\nOrder: {{order_number}}\n\n{{order_items}}\n\nWe’re getting it ready and will email you again as it moves along.', cta: view.en },
      el: { subject: 'Παραγγελία {{order_number}}: λάβαμε την πληρωμή', body: 'Ευχαριστούμε {{customer_name}}, η πληρωμή σου {{order_total}} ολοκληρώθηκε και λάβαμε την παραγγελία σου.\n\nΠαραγγελία: {{order_number}}\n\n{{order_items}}\n\nΤην ετοιμάζουμε και θα σε ενημερώνουμε σε κάθε βήμα.', cta: view.el },
      ru: { subject: 'Заказ {{order_number}}: оплата получена', body: 'Спасибо, {{customer_name}}, оплата {{order_total}} прошла, и мы получили ваш заказ.\n\nЗаказ: {{order_number}}\n\n{{order_items}}\n\nМы готовим его и напишем, когда он будет продвигаться.', cta: view.ru },
    }),
    base('order_confirmed', 'Order confirmed', 'Store confirms the order', ['delivery_estimate'], {
      en: { subject: 'Order {{order_number}} confirmed', body: 'Good news, {{customer_name}}, we’ve confirmed your order {{order_number}}.\n\nEstimated delivery: {{delivery_estimate}}', cta: view.en },
      el: { subject: 'Η παραγγελία {{order_number}} επιβεβαιώθηκε', body: 'Καλά νέα, {{customer_name}}, επιβεβαιώσαμε την παραγγελία σου {{order_number}}.\n\nΕκτιμώμενη παράδοση: {{delivery_estimate}}', cta: view.el },
      ru: { subject: 'Заказ {{order_number}} подтверждён', body: 'Хорошие новости, {{customer_name}}, ваш заказ {{order_number}} подтверждён.\n\nОриентировочная доставка: {{delivery_estimate}}', cta: view.ru },
    }, { note: `${ORDER_NOTE} Skipped when the payment email went out moments before, they would say the same thing.` }),
    base('order_preparing', 'Preparing', 'Status → preparing', [], {
      en: { subject: 'We’re preparing order {{order_number}}', body: 'Your order {{order_number}} is being picked and packed.', cta: view.en },
      el: { subject: 'Ετοιμάζουμε την παραγγελία {{order_number}}', body: 'Η παραγγελία σου {{order_number}} συσκευάζεται.', cta: view.el },
      ru: { subject: 'Готовим заказ {{order_number}}', body: 'Ваш заказ {{order_number}} собирается и упаковывается.', cta: view.ru },
    }),
    base('order_ready_for_pickup', 'Ready to collect', 'Status → ready for pickup', ['pickup_address', 'opening_hours'], {
      en: { subject: 'Order {{order_number}} is ready to collect', body: 'Your order {{order_number}} is ready.\n\nCollect from: {{pickup_address}}\nOpen: {{opening_hours}}\n\nBring your order number.', cta: view.en },
      el: { subject: 'Η παραγγελία {{order_number}} είναι έτοιμη για παραλαβή', body: 'Η παραγγελία σου {{order_number}} είναι έτοιμη.\n\nΠαραλαβή από: {{pickup_address}}\nΩράριο: {{opening_hours}}\n\nΦέρε τον αριθμό παραγγελίας.', cta: view.el },
      ru: { subject: 'Заказ {{order_number}} готов к выдаче', body: 'Ваш заказ {{order_number}} готов.\n\nЗабрать: {{pickup_address}}\nЧасы работы: {{opening_hours}}\n\nВозьмите номер заказа.', cta: view.ru },
    }),
    base('order_shipped', 'Out for delivery', 'Status → out for delivery', ['tracking_number', 'tracking_url', 'delivery_estimate'], {
      en: { subject: 'Order {{order_number}} is on its way', body: 'Your order {{order_number}} is out for delivery.\n\nTracking number: {{tracking_number}}\n\nTrack it: {{tracking_url}}\n\nEstimated arrival: {{delivery_estimate}}', cta: view.en },
      el: { subject: 'Η παραγγελία {{order_number}} είναι καθ’ οδόν', body: 'Η παραγγελία σου {{order_number}} ξεκίνησε.\n\nΑριθμός αποστολής: {{tracking_number}}\n\nΠαρακολούθηση: {{tracking_url}}\n\nΕκτιμώμενη άφιξη: {{delivery_estimate}}', cta: view.el },
      ru: { subject: 'Заказ {{order_number}} в пути', body: 'Ваш заказ {{order_number}} отправлен.\n\nТрек-номер: {{tracking_number}}\n\nОтследить: {{tracking_url}}\n\nОриентировочная доставка: {{delivery_estimate}}', cta: view.ru },
    }, { note: `${ORDER_NOTE} The tracking lines appear only when the courier gave a real number.` }),
    base('order_delivered', 'Delivered', 'Status → delivered', [], {
      en: { subject: 'Order {{order_number}} delivered', body: 'Your order {{order_number}} has been delivered. Something not right? Reply to this email and we’ll sort it.', cta: view.en },
      el: { subject: 'Η παραγγελία {{order_number}} παραδόθηκε', body: 'Η παραγγελία σου {{order_number}} παραδόθηκε. Κάτι δεν είναι σωστό; Απάντησε σε αυτό το email και θα το λύσουμε.', cta: view.el },
      ru: { subject: 'Заказ {{order_number}} доставлен', body: 'Ваш заказ {{order_number}} доставлен. Что-то не так? Ответьте на это письмо, мы разберёмся.', cta: view.ru },
    }),
    base('order_completed', 'Completed', 'Order completed', [], {
      en: { subject: 'Thank you for your order {{order_number}}', body: 'Your order {{order_number}} is complete. Thank you for shopping with AIONIX.', cta: view.en },
      el: { subject: 'Ευχαριστούμε για την παραγγελία {{order_number}}', body: 'Η παραγγελία σου {{order_number}} ολοκληρώθηκε. Ευχαριστούμε που ψώνισες από το AIONIX.', cta: view.el },
      ru: { subject: 'Спасибо за заказ {{order_number}}', body: 'Ваш заказ {{order_number}} завершён. Спасибо, что выбрали AIONIX.', cta: view.ru },
    }, { note: `${ORDER_NOTE} Skipped when “Delivered” went out within the last two days.` }),
    base('order_cancelled', 'Order cancelled', 'Order cancelled', ['refund_amount'], {
      en: { subject: 'Order {{order_number}} cancelled', body: 'Your order {{order_number}} has been cancelled.\n\nA refund of {{refund_amount}} is on its way back to your card. Banks usually take 5–10 working days to show it.', cta: view.en },
      el: { subject: 'Η παραγγελία {{order_number}} ακυρώθηκε', body: 'Η παραγγελία σου {{order_number}} ακυρώθηκε.\n\nΗ επιστροφή {{refund_amount}} είναι καθ’ οδόν στην κάρτα σου. Οι τράπεζες συνήθως χρειάζονται 5–10 εργάσιμες.', cta: view.el },
      ru: { subject: 'Заказ {{order_number}} отменён', body: 'Ваш заказ {{order_number}} отменён.\n\nВозврат {{refund_amount}} отправлен на вашу карту. Банку обычно нужно 5–10 рабочих дней.', cta: view.ru },
    }),
  ]
}

export const TEMPLATE_BY_KEY = new Map(TEMPLATES.map((t) => [t.key, t]))
export function templateDef(key: TemplateKey): TemplateDef {
  const def = TEMPLATE_BY_KEY.get(key)
  if (!def) throw new Error(`Unknown email template ${key}`)
  return def
}

/** The same key list the admin API accepts. */
export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key) as [TemplateKey, ...TemplateKey[]]

/** 240 → "4 hours", 1440 → "1 day", 90 → "90 min" — for the admin. */
export function delayLabel(minutes: number) {
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} min`
}

/* ------------------------------------------------ future triggers --- */
/* Planned, not built — listed so the admin can see what is coming and the
   job system (lib/automations.ts) already has a place for each. */
export const PLANNED_TRIGGERS = [
  'First order',
  'Second order',
  'Inactive customer',
  'Wishlist item available',
  'Price drop',
  'Promotion ending',
  'Loyalty milestone',
] as const

/* ============================================================ render == */

export type Override = { subject?: string; body?: string; cta?: string }

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const TOKEN = /\{\{\s*([a-z_]+)\s*\}\}/g

/** Variables used in a piece of text that the template does not allow. */
export function unknownVariables(text: string, allowed: string[]): string[] {
  const bad = new Set<string>()
  for (const m of text.matchAll(TOKEN)) if (!allowed.includes(m[1])) bad.add(m[1])
  return [...bad]
}

/** The words for a language: the owner's where they wrote some, the built-in
 *  text otherwise, English when this language has nothing at all. */
export function wordsFor(def: TemplateDef, locale: Locale, override?: Record<string, Override> | null): Words {
  const pick = (loc: Locale): Words => {
    const own = override?.[loc] ?? {}
    const builtIn = def.words[loc]
    return {
      subject: own.subject?.trim() || builtIn.subject,
      body: own.body?.trim() || builtIn.body,
      cta: own.cta?.trim() || builtIn.cta,
    }
  }
  const words = pick(def.internal ? 'en' : locale)
  return words.subject && words.body ? words : pick('en')
}

const isEmpty = (v: VarValue) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
const asText = (v: VarValue) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')

function absolute(url: string | null | undefined, base: string): string | null {
  if (!url) return null
  return /^https?:\/\//.test(url) ? url : `${base.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`
}

function blockHtml(kind: VarDef['block'], value: VarValue, base: string): string {
  if (kind === 'code') {
    return `<p style="margin:18px 0;font-size:32px;letter-spacing:.3em;font-weight:600;font-family:ui-monospace,Menlo,monospace">${escapeHtml(asText(value))}</p>`
  }
  if (kind === 'quote') {
    return `<div style="border-left:3px solid #111;padding:8px 14px;background:#f6f6f4;white-space:pre-wrap;margin:0 0 14px">${escapeHtml(asText(value))}</div>`
  }
  if (kind === 'items' && Array.isArray(value)) {
    const rows = (value as Item[])
      .map((it) => {
        const img = absolute(it.image, base)
        return `<tr><td style="padding:10px 12px 10px 0;width:64px;vertical-align:top">${
          img ? `<img src="${escapeHtml(img)}" alt="" width="64" style="display:block;width:64px;height:auto;background:#f2f2f0">` : ''
        }</td><td style="padding:10px 0;vertical-align:top;font-size:14px"><span style="display:block;font-weight:600">${escapeHtml(it.name)}</span>${
          it.detail ? `<span style="display:block;color:#6b6b6b;font-size:13px">${escapeHtml(it.detail)}</span>` : ''
        }<span style="display:block;color:#6b6b6b;font-size:13px">× ${escapeHtml(String(it.quantity))}</span></td><td style="padding:10px 0;text-align:right;vertical-align:top;font-size:14px;white-space:nowrap">${escapeHtml(it.price)}</td></tr>`
      })
      .join('')
    return `<table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #e5e5e5;border-bottom:1px solid #e5e5e5;margin:4px 0 18px">${rows}</table>`
  }
  if (kind === 'transcript' && Array.isArray(value)) {
    return (value as TranscriptLine[])
      .map(
        (l) => `<div style="margin:0 0 14px;${l.customer ? 'padding-left:32px' : 'padding-right:32px'}">
<p style="margin:0 0 3px;font-size:12px;color:#6b6b6b">${escapeHtml(l.from)} · ${escapeHtml(l.at)}</p>
<div style="padding:10px 14px;white-space:pre-wrap;${l.customer ? 'background:#111;color:#fff' : 'background:#f2f2f0'}">${escapeHtml(l.text)}</div></div>`,
      )
      .join('')
  }
  if (kind === 'product' && value && typeof value === 'object' && !Array.isArray(value)) {
    const p = value as ProductBlock
    const img = absolute(p.image, base)
    return `<div style="margin:6px 0 18px">${img ? `<img src="${escapeHtml(img)}" alt="" width="240" style="display:block;width:240px;max-width:100%;height:auto;background:#f2f2f0">` : ''}<p style="margin:10px 0 0;font-weight:600">${escapeHtml(p.name)}</p>${
      p.detail ? `<p style="margin:2px 0 0;color:#6b6b6b;font-size:14px">${escapeHtml(p.detail)}</p>` : ''
    }${p.price ? `<p style="margin:2px 0 0;font-size:14px">${escapeHtml(p.price)}</p>` : ''}</div>`
  }
  return ''
}

function blockText(kind: VarDef['block'], value: VarValue): string {
  if (kind === 'items' && Array.isArray(value)) {
    return (value as Item[]).map((it) => `${it.name}${it.detail ? ` (${it.detail})` : ''} × ${it.quantity}, ${it.price}`).join('\n')
  }
  if (kind === 'transcript' && Array.isArray(value)) {
    return (value as TranscriptLine[]).map((l) => `${l.from} · ${l.at}\n${l.text}`).join('\n\n')
  }
  if (kind === 'product' && value && typeof value === 'object' && !Array.isArray(value)) {
    const p = value as ProductBlock
    return [p.name, p.detail, p.price].filter(Boolean).join(' · ')
  }
  return asText(value)
}

/** The email frame: brand, white card, footer. `inner` is already safe HTML. */
export function htmlLayout(inner: string, footer = ''): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<p style="font-weight:700;letter-spacing:.22em;font-size:16px;margin:0 0 24px;background:${BRAND.theme.paper};color:#fff;padding:16px 20px;border-bottom:3px solid ${BRAND.theme.accent}">${escapeHtml(BRAND.name)}</p>
<div style="background:#fff;border:1px solid #e5e5e5;padding:28px 24px;font-size:15px;line-height:1.55">${inner}</div>
<p style="font-size:12px;color:#6b6b6b;line-height:1.5;margin:20px 0 0">${escapeHtml(BRAND.name)} · ${escapeHtml(BRAND.contact.email)}${footer}</p>
</div></body></html>`
}

export function button(href: string, label: string): string {
  return `<p style="margin:24px 0 4px"><a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND.theme.accent};color:${BRAND.theme.accentInk};font-weight:700;text-decoration:none;padding:13px 22px;font-size:13px;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(label)}</a></p>`
}

export type Rendered = { subject: string; text: string; html: string }

/**
 * Words + variables → an email. Pure: no database, no network.
 *
 * Only the template's own variables are filled in; anything else in braces
 * is removed. Every value is escaped for HTML. A paragraph whose variables
 * are all empty this time is left out.
 */
export function render(
  def: TemplateDef,
  words: Words,
  vars: Vars,
  opts: { siteBase: string; footer?: { text: string; html: string } } = { siteBase: '' },
): Rendered {
  const allowed = new Set(def.variables)
  const value = (name: string) => (allowed.has(name) ? vars[name] : undefined)

  const fillText = (s: string) => s.replace(TOKEN, (_, name: string) => asText(value(name)))
  const subject = fillText(words.subject).replace(/\s+/g, ' ').trim()

  const htmlParts: string[] = []
  const textParts: string[] = []
  for (const raw of words.body.split(/\n{2,}/)) {
    const para = raw.trim()
    if (!para) continue
    const names = [...para.matchAll(TOKEN)].map((m) => m[1])
    /* A paragraph that is exactly one block variable becomes that block. */
    const only = /^\{\{\s*([a-z_]+)\s*\}\}$/.exec(para)?.[1]
    const block = only ? VARIABLES[only]?.block : undefined
    if (only && block) {
      const v = value(only)
      if (isEmpty(v)) continue
      htmlParts.push(blockHtml(block, v, opts.siteBase))
      textParts.push(blockText(block, v))
      continue
    }
    /* Leave out a paragraph that needs something we do not have this time —
       "Tracking number: " with no number, "Hi ," with no name. */
    if (names.some((n) => isEmpty(value(n)))) continue
    textParts.push(fillText(para))
    const html = escapeHtml(para)
      .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => {
        const v = value(name)
        const text = asText(v)
        /* A link variable (…_url) becomes a link. Never anything a customer
           typed, such as a name that looks like a web address. */
        return /_url$/.test(name) && /^https?:\/\//.test(text)
          ? `<a href="${escapeHtml(text)}" style="color:#111">${escapeHtml(text.replace(/^https?:\/\//, ''))}</a>`
          : escapeHtml(text)
      })
      .replace(/\n/g, '<br>')
    htmlParts.push(`<p style="margin:0 0 14px">${html}</p>`)
  }

  const ctaHref = def.ctaUrl ? absolute(asText(vars[def.ctaUrl]) || null, opts.siteBase) : null
  const ctaLabel = words.cta ? fillText(words.cta) : ''
  if (ctaHref && ctaLabel) {
    htmlParts.push(button(ctaHref, ctaLabel))
    textParts.push(`${ctaLabel}: ${ctaHref}`)
  }

  const footerText = opts.footer?.text ? `\n\n—\n${opts.footer.text}` : `\n\n—\n${BRAND.name}`
  return {
    subject,
    text: `${textParts.join('\n\n')}${footerText}\n`,
    html: htmlLayout(htmlParts.join('\n'), opts.footer?.html ?? ''),
  }
}

/** Sample values for this template's variables, for previews and tests. */
export function sampleVars(def: TemplateDef): Vars {
  return Object.fromEntries(def.variables.map((v) => [v, VARIABLES[v]?.sample]))
}
