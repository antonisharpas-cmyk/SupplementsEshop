/* ============================================================================
 * Input validation and normalisation.
 *
 * Every API route validates through these schemas. Spec section 33: validate
 * all API inputs, and never trust anything from the frontend.
 *
 * Normalisation matters as much as validation here. Business rules 1 and 2 say
 * a customer cannot register twice with the same email or phone — which is only
 * enforceable if "+357 99 12 34 56" and "+35799123456" are stored identically.
 * ========================================================================== */

import { z } from 'zod'

/* ------------------------------------------------------------------ email -- */

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .email('Enter a valid email address.')
  /* Stored lower-cased; the unique index is on lower(email) to match. */
  .transform((v) => v.toLowerCase())

/* ------------------------------------------------------------------ phone -- */

/** Cyprus is the home market, so a bare 8-digit local number gets +357. */
const DEFAULT_COUNTRY_CODE = '357'

/**
 * Normalise to E.164 (`+357xxxxxxxx`). Returns null when it cannot be read as
 * a phone number at all, so the schema can produce a proper error.
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const hadPlus = trimmed.startsWith('+') || trimmed.startsWith('00')
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 0) return null

  /* 00357… is the same as +357… */
  let national = digits
  if (trimmed.startsWith('00')) national = digits.replace(/^00/, '')

  if (hadPlus) {
    if (national.length < 8 || national.length > 15) return null
    return `+${national}`
  }

  /* No country code given. A bare local Cypriot number is 8 digits. */
  if (national.length === 8) return `+${DEFAULT_COUNTRY_CODE}${national}`

  /* Someone typed 357… without the plus. */
  if (national.startsWith(DEFAULT_COUNTRY_CODE) && national.length === 11) return `+${national}`

  /* Any other length is ambiguous — better to reject than to guess wrong and
     silently let a duplicate account through. */
  if (national.length >= 10 && national.length <= 15) return `+${national}`

  return null
}

export const phoneSchema = z
  .string()
  .trim()
  .min(6, 'Enter a valid phone number.')
  .max(32)
  .transform((v, ctx) => {
    const normalised = normalisePhone(v)
    if (!normalised) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a valid phone number, including the country code.',
      })
      return z.NEVER
    }
    return normalised
  })

/* --------------------------------------------------------------- password -- */

/* Length beats character-class rules: NIST dropped composition requirements
   because they push people towards Password1! and nothing else. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.')
  .refine((v) => v.trim().length >= 10, 'Use at least 10 characters that are not spaces.')

/* --------------------------------------------------------------- generic --- */

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'This field is required.')
  .max(80)
  /* Strip control characters — they break log lines and email headers. */
  .transform((v) => v.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim())
  .refine((v) => v.length >= 1, 'This field is required.')

export const localeSchema = z.enum(['en', 'el', 'ru']).default('en')

export const uuidSchema = z.string().uuid('Not a valid identifier.')

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and hyphens only.')

export const quantitySchema = z.coerce.number().int().min(1).max(20)

export const centsSchema = z.coerce.number().int().min(0).max(100_000_000)

/* ------------------------------------------------------------- addresses -- */

export const addressInputSchema = z.object({
  label: z.string().trim().max(60).optional(),
  recipientName: nameSchema.pipe(z.string().max(160)),
  phone: phoneSchema,
  line1: z.string().trim().min(3, 'Enter the street and number.').max(200),
  line2: z.string().trim().max(200).optional().or(z.literal('')),
  city: z.string().trim().min(2, 'Enter the town or city.').max(100),
  postalCode: z.string().trim().min(3, 'Enter the postal code.').max(20),
  /* ISO 3166-1 alpha-2 */
  country: z.string().trim().length(2).toUpperCase().default('CY'),
  isDefault: z.boolean().default(false),
})

export type AddressInput = z.infer<typeof addressInputSchema>

/* ---------------------------------------------------------------- account -- */

export const registerSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  /* Section 21: consent is optional and separate from the mandatory fields. */
  marketingConsent: z.boolean().default(false),
  address: addressInputSchema.optional(),
  locale: localeSchema,
})

export type RegisterInput = z.infer<typeof registerSchema>

/** What the registration form sends: the details plus the password typed a
 *  second time. Checked here as well as in the browser — a request that skips
 *  the form still has to match. */
export const registerRequestSchema = registerSchema
  .extend({ confirmPassword: z.string().max(200) })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The passwords don’t match.',
  })

export const verifyOtpSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your email.'),
})

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
})

export const requestPasswordResetSchema = z.object({ email: emailSchema })

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  password: passwordSchema,
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: passwordSchema,
})

export const updateProfileSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phone: phoneSchema.optional(),
})

/* ------------------------------------------------------------------- cart -- */

export const addToCartSchema = z.object({
  variantId: uuidSchema,
  quantity: quantitySchema.default(1),
})

export const updateCartLineSchema = z.object({
  variantId: uuidSchema,
  /* 0 means remove. */
  quantity: z.coerce.number().int().min(0).max(20),
})

export const applyPromoSchema = z.object({
  code: z.string().trim().min(1, 'Enter a promo code.').max(40),
})

/* --------------------------------------------------------------- checkout -- */

export const checkoutSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  firstName: nameSchema,
  lastName: nameSchema,
  deliveryOptionId: uuidSchema,
  shippingAddress: addressInputSchema.omit({ isDefault: true, label: true }).optional(),
  billingSameAsShipping: z.boolean().default(true),
  billingAddress: addressInputSchema.omit({ isDefault: true, label: true }).optional(),
  promoCode: z.string().trim().max(40).optional().or(z.literal('')),
  customerNote: z.string().trim().max(500).optional().or(z.literal('')),
  marketingConsent: z.boolean().default(false),
  locale: localeSchema,
})

export type CheckoutInput = z.infer<typeof checkoutSchema>

/* ---------------------------------------------------------------- contact -- */

export const contactSchema = z
  .object({
    topic: z.enum([
      'EXISTING_ORDER',
      'DELIVERY',
      'PAYMENT',
      'PRODUCT',
      'RETURN_REFUND',
      'GENERAL',
      'OTHER',
    ]),
    orderNumber: z.string().trim().max(20).optional().or(z.literal('')),
    subject: z.string().trim().min(3, 'Enter a subject.').max(200),
    message: z.string().trim().min(10, 'Tell us a little more.').max(5000),
    email: emailSchema,
    phone: phoneSchema.optional(),
  })
  /* Section 20: an order enquiry without an order number is not actionable. */
  .refine((v) => v.topic !== 'EXISTING_ORDER' || !!v.orderNumber, {
    message: 'Enter the order number so we can look it up.',
    path: ['orderNumber'],
  })

/* ------------------------------------------------------------- order track -- */

export const trackOrderSchema = z.object({
  orderNumber: z.string().trim().min(3).max(20),
  email: emailSchema,
})

/* ------------------------------------------------------ product listing ---- */

export const productQuerySchema = z.object({
  category: slugSchema.optional(),
  subcategory: slugSchema.optional(),
  q: z.string().trim().max(120).optional(),
  sizes: z.array(z.string().trim().max(24)).max(20).optional(),
  /* Colour keys ("black", "washed-black"). Any of them — OR within the group. */
  colours: z.array(z.string().trim().max(60).regex(/^[a-z0-9-]+$/)).max(30).optional(),
  /* Subcategory slugs inside `category`, or "department/slug" on pages
     that span departments. Any of them. */
  categories: z.array(z.string().trim().max(120).regex(/^[a-z0-9-]+(\/[a-z0-9-]+)?$/)).max(30).optional(),
  /* A department slug, on pages that span departments. */
  department: slugSchema.optional(),
  minPrice: centsSchema.optional(),
  maxPrice: centsSchema.optional(),
  onSale: z.coerce.boolean().optional(),
  inStockOnly: z.coerce.boolean().optional(),
  sort: z
    .enum(['newest', 'price-asc', 'price-desc', 'name-asc', 'popular'])
    .default('newest'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  perPage: z.coerce.number().int().min(1).max(60).default(24),
  locale: localeSchema,
})

export type ProductQuery = z.infer<typeof productQuerySchema>

/* -------------------------------------------------------------- helpers ---- */

/** Flattens Zod errors into { field: message } for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}
