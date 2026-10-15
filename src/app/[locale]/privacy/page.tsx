/* ============================================================================
 * Privacy notice — what the shop collects, why, and how to stop it.
 *
 * DRAFT FOR LEGAL REVIEW. It describes what this code actually does
 * (accounts, bags, the newsletter's double opt-in, Customer Service chats,
 * hashed IP addresses) so it is accurate as far as it goes, but it is not
 * legal advice: have it checked before launch, and fill in the company
 * details in src/config/brand.ts.
 * ========================================================================== */

import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'

type Props = { params: Promise<{ locale: string }> }
type Section = { title: string; body: string[] }

function content(locale: Locale): { title: string; updated: string; sections: Section[] } {
  const company = `${BRAND.legal.companyName}, ${BRAND.contact.addressLines.join(', ')}`
  const email = BRAND.contact.email
  if (locale === 'el')
    return {
      title: 'Πολιτική απορρήτου',
      updated: 'Τελευταία ενημέρωση: Σεπτέμβριος 2026',
      sections: [
        { title: 'Ποιοι είμαστε', body: [`Υπεύθυνος επεξεργασίας είναι η ${company}. Για οτιδήποτε αφορά τα δεδομένα σου γράψε μας στο ${email}.`] },
        { title: 'Τι συλλέγουμε', body: ['Λογαριασμός: όνομα, email, τηλέφωνο, διευθύνσεις και κωδικός (αποθηκεύεται μόνο κρυπτογραφημένος, κανείς, ούτε εμείς, δεν μπορεί να τον δει).', 'Καλάθι και παραγγελίες: τα προϊόντα και τα στοιχεία παράδοσης. Τα στοιχεία κάρτας τα χειρίζεται ο πάροχος πληρωμών· δεν τα αποθηκεύουμε ποτέ.', 'Newsletter: email, προαιρετικά όνομα, γλώσσα, και πότε και πού έδωσες τη συγκατάθεσή σου.', 'Εξυπηρέτηση Πελατών: τα μηνύματα της συνομιλίας, και όνομα και email αν τα δώσεις.', 'Ασφάλεια: η διεύθυνση IP αποθηκεύεται μόνο ως μη αναστρέψιμο hash, για την πρόληψη κατάχρησης.'] },
        { title: 'Γιατί', body: ['Για να λειτουργήσει ο λογαριασμός και να ολοκληρωθούν οι παραγγελίες (εκτέλεση σύμβασης), για να απαντήσουμε στις ερωτήσεις σου, και για να σου στέλνουμε νέες αφίξεις μόνο αν συμφώνησες.'] },
        { title: 'Διαφημιστικά email', body: ['Στέλνουμε μόνο σε όσους τσέκαραν το κουτί και επιβεβαίωσαν τη διεύθυνσή τους. Κάθε email έχει σύνδεσμο διαγραφής· η διαγραφή δεν χρειάζεται σύνδεση. Τα email για παραγγελίες και λογαριασμό συνεχίζουν να έρχονται.'] },
        { title: 'Για πόσο', body: ['Όσο υπάρχει ο λογαριασμός σου, και τα στοιχεία παραγγελιών όσο απαιτεί η φορολογική νομοθεσία. Κρατάμε αρχείο των συγκαταθέσεων και διαγραφών ώστε να μπορούμε να αποδείξουμε ότι σεβαστήκαμε την επιλογή σου.'] },
        { title: 'Τα δικαιώματά σου', body: [`Πρόσβαση, διόρθωση, διαγραφή, περιορισμός, φορητότητα και εναντίωση. Γράψε μας στο ${email}. Μπορείς επίσης να απευθυνθείς στον Επίτροπο Προστασίας Δεδομένων Προσωπικού Χαρακτήρα της Κύπρου.`] },
      ],
    }
  if (locale === 'ru')
    return {
      title: 'Политика конфиденциальности',
      updated: 'Последнее обновление: сентябрь 2026',
      sections: [
        { title: 'Кто мы', body: [`Оператор данных, ${company}. По любым вопросам о ваших данных пишите на ${email}.`] },
        { title: 'Что мы собираем', body: ['Аккаунт: имя, email, телефон, адреса и пароль (хранится только в зашифрованном виде, никто, включая нас, не может его увидеть).', 'Корзина и заказы: товары и данные доставки. Данные карты обрабатывает платёжный провайдер; мы их никогда не храним.', 'Рассылка: email, по желанию имя, язык, а также когда и где вы дали согласие.', 'Служба поддержки: сообщения разговора, а также имя и email, если вы их укажете.', 'Безопасность: IP-адрес хранится только в виде необратимого хеша для защиты от злоупотреблений.'] },
        { title: 'Зачем', body: ['Чтобы работал аккаунт и выполнялись заказы (исполнение договора), чтобы отвечать на ваши вопросы и присылать новинки, только если вы согласились.'] },
        { title: 'Рекламные письма', body: ['Мы пишем только тем, кто отметил согласие и подтвердил адрес. В каждом письме есть ссылка для отписки; входить в аккаунт не нужно. Письма о заказах и аккаунте продолжат приходить.'] },
        { title: 'Как долго', body: ['Пока существует ваш аккаунт, а данные заказов, столько, сколько требует налоговое законодательство. Мы храним историю согласий и отписок, чтобы подтвердить, что уважали ваш выбор.'] },
        { title: 'Ваши права', body: [`Доступ, исправление, удаление, ограничение, переносимость и возражение. Пишите на ${email}. Вы также можете обратиться к Уполномоченному по защите персональных данных Кипра.`] },
      ],
    }
  return {
    title: 'Privacy notice',
    updated: 'Last updated: September 2026',
    sections: [
      { title: 'Who we are', body: [`The controller of your data is ${company}. For anything about your data, email ${email}.`] },
      { title: 'What we collect', body: ['Account: name, email, phone, addresses and password (stored only as a one-way hash, nobody, including us, can read it).', 'Bag and orders: the products and the delivery details. Card details are handled by the payment provider; we never store them.', 'Newsletter: your email, optionally your first name, your language, and when and where you gave consent.', 'Customer Service: the messages in your conversation, and your name and email if you give them.', 'Security: IP addresses are kept only as an irreversible hash, to prevent abuse.'] },
      { title: 'Why', body: ['To run your account and fulfil orders (performing our contract with you), to answer your questions, and to email you about new arrivals, only if you said yes.'] },
      { title: 'Marketing emails', body: ['We only email people who ticked the box and confirmed their address. Every email has an unsubscribe link, and unsubscribing never needs a login. Emails about your orders and account still arrive.'] },
      { title: 'How long', body: ['For as long as your account exists, and order records for as long as tax law requires. We keep a record of each consent and unsubscribe so we can show we respected your choice.'] },
      { title: 'Your rights', body: [`Access, correction, deletion, restriction, portability and objection. Email ${email}. You can also complain to the Cyprus Commissioner for Personal Data Protection.`] },
    ],
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  return { title: content(locale).title }
}

export default async function PrivacyPage({ params }: Props) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const c = content(locale)
  return (
    <article className="container-x max-w-3xl py-12 md:py-16">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{c.title}</h1>
      <p className="mt-2 text-sm text-muted">{c.updated}</p>
      {c.sections.map((s) => (
        <section key={s.title} className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">{s.title}</h2>
          {s.body.map((p) => (
            <p key={p} className="mt-3 text-sm leading-relaxed text-ink-soft">
              {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  )
}
