import { z } from 'zod'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* What the owner types and chooses for a mailing. Plain text only — it is
   escaped into the email, so markup arrives as the characters typed. */
export const draftSchema = z.object({
  kind: z.enum(['new_arrivals', 'promotion']),
  subject: z.string().trim().min(3, 'Give it a subject line.').max(150),
  message: z.string().trim().min(10, 'Write a sentence or two for the top of the email.').max(3000),
  productIds: z.array(z.string().regex(UUID)).max(6).optional(),
  categoryId: z.string().regex(UUID).nullable().optional(),
  audience: z.enum(['all', 'en', 'el', 'ru']).default('all'),
  ctaLabel: z.string().trim().max(40).optional(),
  ctaTarget: z.enum(['new', 'sale', 'category', 'shop']).optional(),
  promoCode: z.string().trim().max(40).regex(/^[A-Za-z0-9_-]*$/, 'A code is letters, digits, - and _.').optional(),
  promoExpires: z.string().trim().max(60).optional(),
})
