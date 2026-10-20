/* The AI assistant in the chat, with a scripted model: it answers, looks
   products up, shows cards and one-tap replies, hands over to a person, and
   stops when staff reply or the customer asks for a person. */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { categories, inventory, productVariants, products, supportConversations, supportMessages, users } from '@/db/schema'

process.env.ANTHROPIC_API_KEY = 'test-key'

vi.mock('@/lib/email', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/email')>()
  return { ...real, send: vi.fn(async () => ({ sent: true as const })) }
})

const s = await import('../support')
const ai = await import('../support-ai')

type Req = Parameters<Parameters<typeof ai.setModelForTests>[0] & object>[0]
const calls: Req[] = []
/** Each step: what the model "does" next. */
function script(steps: ((req: Req) => { content: unknown[]; stop_reason: string })[]) {
  let i = 0
  ai.setModelForTests(async (req) => {
    calls.push(JSON.parse(JSON.stringify(req)))
    const step = steps[Math.min(i++, steps.length - 1)]
    return step(req) as never
  })
}
const say = (text: string) => () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' })
const use = (name: string, input: unknown, id = name) => () => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' })

const guest = () => ({ userId: null, guestToken: s.newGuestToken() })
const G = { name: 'Maria', email: 'maria@example.com', locale: 'en' }
const msgs = async (id: string) =>
  db.select().from(supportMessages).where(eq(supportMessages.conversationId, id)).orderBy(supportMessages.createdAt)

beforeAll(async () => {
  await db.execute(sql`delete from settings where key like 'support_%'`).catch(() => {})
  const [cat] = await db.insert(categories).values({ slug: `ai-cat-${Date.now()}`, name: { en: 'Protein' } }).returning({ id: categories.id })
  const [p] = await db
    .insert(products)
    .values({ categoryId: cat.id, slug: 'ai-test-whey', name: { en: 'Zyxwhey Isolate' }, summary: { en: 'Fast protein' }, priceCents: 4990, isActive: true })
    .returning({ id: products.id })
  const [v] = await db.insert(productVariants).values({ productId: p.id, sku: `AI-TEST-${Date.now()}`, size: '1kg', colorName: { en: 'Chocolate' } }).returning({ id: productVariants.id })
  await db.insert(inventory).values({ variantId: v.id, onHand: 7, reserved: 0 })
})

beforeEach(async () => {
  await db.execute(sql`truncate table support_messages, support_conversations restart identity cascade`)
  ;(await import('../settings')).invalidateSettingsCache()
  calls.length = 0
})

afterAll(async () => {
  ai.setModelForTests(null)
  await pool.end()
})

describe('AI assistant', () => {
  it('answers instead of the canned first reply, and finds products', async () => {
    script([
      use('search_products', { query: 'zyxwhey' }),
      (req) => {
        const last = req.messages.at(-1)!.content as { content: string }[]
        expect(last[0].content).toContain('ai-test-whey')
        expect(last[0].content).toContain('Chocolate')
        return { content: [{ type: 'tool_use', id: 'a', name: 'show_products', input: { slugs: ['ai-test-whey'] } }, { type: 'tool_use', id: 'b', name: 'suggest_replies', input: { options: ['Is it in stock?', 'Delivery time?'] } }], stop_reason: 'tool_use' }
      },
      say('We have **Zyxwhey Isolate** for €49.90 — chocolate, 1kg.'),
    ])
    const { conversationId } = await s.startConversation(guest(), { ...G, message: 'Do you have zyxwhey?' })
    /* No canned reply when the assistant is on. */
    expect((await msgs(conversationId)).filter((m) => m.automated)).toHaveLength(0)

    await ai.runAssistant(conversationId)
    const all = await msgs(conversationId)
    const reply = all.at(-1)!
    expect(reply.ai).toBe(true)
    expect(reply.sender).toBe('STAFF')
    /* Markdown and dashes cleaned for the chat bubble. */
    expect(reply.body).toBe('We have Zyxwhey Isolate for €49.90, chocolate, 1kg.')
    expect(reply.meta?.products?.[0]).toMatchObject({ slug: 'ai-test-whey', name: 'Zyxwhey Isolate', inStock: true })
    expect(reply.meta?.suggestions).toEqual(['Is it in stock?', 'Delivery time?'])
    /* The system prompt carries the rules. */
    expect(calls[0].system).toContain('You are an AI assistant, not a person')
    expect(calls[0].system).toContain('Cyprus only')
  })

  it('a second run with nothing new from the customer does nothing', async () => {
    script([say('Hello!')])
    const { conversationId } = await s.startConversation(guest(), { ...G, message: 'Hi' })
    await ai.runAssistant(conversationId)
    await ai.runAssistant(conversationId)
    expect((await msgs(conversationId)).filter((m) => m.ai)).toHaveLength(1)
  })

  it('hands over when the model decides to, and stops answering', async () => {
    script([use('hand_over_to_team', { reason: 'refund' }), say('A team member will reply here soon.')])
    const actor = guest()
    const { conversationId } = await s.startConversation(actor, { ...G, message: 'I want a refund' })
    await ai.runAssistant(conversationId)
    const view = await s.customerView(actor)
    expect(view.conversation?.assistant).toMatchObject({ active: false, handedOff: true })
    await s.postCustomerMessage(actor, conversationId, 'Hello?')
    await ai.runAssistant(conversationId)
    expect((await msgs(conversationId)).filter((m) => m.ai)).toHaveLength(1)
  })

  it('stops when a member of staff replies', async () => {
    script([say('Hi there')])
    const [staff] = await db
      .insert(users)
      .values({ email: `st-${Date.now()}@example.com`, passwordHash: 'x', firstName: 'A', lastName: 'B', phone: `+3579${Date.now() % 10_000_000}`, role: 'ADMIN' })
      .returning({ id: users.id })
    const actor = guest()
    const { conversationId } = await s.startConversation(actor, { ...G, message: 'Hi' })
    await s.staffReply(conversationId, staff.id, 'Hello, Nikos here')
    const [conv] = await db.select().from(supportConversations).where(eq(supportConversations.id, conversationId))
    expect(conv.aiActive).toBe(false)
    await ai.runAssistant(conversationId)
    expect((await msgs(conversationId)).filter((m) => m.ai)).toHaveLength(0)
  })

  it('"Talk to a person" stops it and says so', async () => {
    const actor = guest()
    const { conversationId } = await s.startConversation(actor, { ...G, message: 'Hi' })
    await ai.customerHandOver(conversationId)
    const view = await s.customerView(actor)
    expect(view.conversation?.assistant.active).toBe(false)
    expect(view.messages.at(-1)?.body).toContain('A member of our team will reply')
  })

  it('a failed model call leaves a polite message and passes to the team', async () => {
    ai.setModelForTests(async () => {
      throw new Error('down')
    })
    const actor = guest()
    const { conversationId } = await s.startConversation(actor, { ...G, message: 'Hi' })
    await ai.runAssistant(conversationId)
    const view = await s.customerView(actor)
    expect(view.messages.at(-1)?.body).toContain('could not answer')
    expect(view.conversation?.assistant).toMatchObject({ active: false, handedOff: true, typing: false })
  })

  it('order lookups only see this customer', async () => {
    let result = ''
    script([
      use('order_status', {}),
      (req) => {
        result = ((req.messages.at(-1)!.content as { content: string }[])[0]).content
        return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
      },
    ])
    const { conversationId } = await s.startConversation(guest(), { ...G, email: 'nobody-here@example.com', message: 'Where is my order?' })
    await ai.runAssistant(conversationId)
    expect(result).toBe('This customer has no orders.')
  })
})
