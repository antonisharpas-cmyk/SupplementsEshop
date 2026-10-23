import { z } from 'zod'

const text = (max: number) => z.string().trim().max(max).optional().or(z.literal(''))

export const l10n = (max: number, required = false) =>
  z.object({
    en: required ? z.string().trim().min(1, 'Write it in English at least.').max(max) : text(max).transform((v) => v ?? ''),
    el: text(max),
    ru: text(max),
  })

export const money = z.number().int().min(0).max(100_000_000)

export const detailsSchema = z.object({
  name: l10n(200, true),
  summary: l10n(300).optional(),
  description: l10n(5000).optional(),
  usage: l10n(3000).optional(),
  seoTitle: l10n(200).optional(),
  seoDescription: l10n(400).optional(),
  categoryId: z.string().uuid('Choose a category.'),
  slug: z
    .string()
    .trim()
    .max(150)
    .regex(/^[a-z0-9-]*$/, 'Use lower-case letters, numbers and hyphens only.')
    .optional()
    .or(z.literal('')),
})

export const createProductSchema = detailsSchema.extend({
  priceCents: money.refine((v) => v > 0, 'Enter a price.'),
  /* The first size, so the product shows in Stock straight away. */
  firstSize: z.string().trim().min(1, 'Enter the pack size, e.g. 1kg or 90 caps.').max(24),
  firstFlavour: z.string().trim().max(80).optional().or(z.literal('')),
  firstStock: z.number().int().min(0).max(1_000_000).default(0),
})

export const variantSchema = z.object({
  size: z.string().trim().min(1, 'Enter a size, e.g. 1kg or 90 caps.').max(24),
  flavour: l10n(80, true),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour.'),
  /* Accepted for older clients but ignored: SKUs are made by the system. */
  sku: z.string().trim().max(60).optional().or(z.literal('')),
  supplierCode: z.string().trim().max(64).optional().or(z.literal('')),
  priceCents: money.nullable().optional(),
  salePriceCents: money.nullable().optional(),
  onHand: z.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
})

export const categoryNameSchema = z.object({
  en: z.string().trim().min(1, 'Give the category a name in English.').max(80),
  el: z.string().trim().max(80).optional(),
  ru: z.string().trim().max(80).optional(),
})

/* A promotion as the admin form sends it. Dates are ISO strings. */
export const promotionSchema = z
  .object({
    name: z.string().trim().min(1, 'Give it a name.').max(160),
    scope: z.enum(['PRODUCT', 'CATEGORY', 'ALL']),
    productId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    discountType: z.enum(['PERCENTAGE', 'FIXED']),
    discountValue: z.number().int().min(1).max(1_000_000),
    badge: z.object({ en: z.string().max(60).optional(), el: z.string().max(60).optional(), ru: z.string().max(60).optional() }).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable(),
    showOnHomepage: z.boolean(),
    isActive: z.boolean(),
  })

/* A promo code as the admin form sends it. Money in cents. */
export const promoCodeSchema = z.object({
  code: z.string().trim().min(3, 'At least 3 characters.').max(40),
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  discountValue: z.number().int().min(1).max(1_000_000),
  minOrderCents: z.number().int().min(0).max(100_000_000),
  maxUses: z.number().int().min(1).nullable(),
  maxUsesPerUser: z.number().int().min(1).nullable(),
  categoryId: z.string().uuid().nullable(),
  startsAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  isActive: z.boolean(),
})
