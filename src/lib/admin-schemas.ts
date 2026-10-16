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
  sku: z.string().trim().max(60).regex(/^[A-Za-z0-9._-]*$/, 'Letters, numbers, dots and hyphens only.').optional().or(z.literal('')),
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
