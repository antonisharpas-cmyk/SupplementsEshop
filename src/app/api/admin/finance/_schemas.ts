/* Request shapes shared by the finance routes. */
import { z } from 'zod'

export const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Give the supplier a name.').max(160),
  kind: z.enum(['manufacturer', 'retailer', 'other']),
  country: z.string().trim().length(2, 'Choose the country.'),
  vatNumber: z.string().max(40).nullish(),
  vatTreatment: z.enum(['DOMESTIC', 'EU_REVERSE', 'IMPORT', 'NONE']),
  email: z.string().max(255).nullish(),
  phone: z.string().max(40).nullish(),
  address: z.string().max(1000).nullish(),
  note: z.string().max(2000).nullish(),
  isActive: z.boolean().optional(),
})

export const money = z.number().int().min(0).max(1_000_000_000)
export const purchaseSchema = z.object({
  supplierId: z.string().uuid('Choose the supplier.'),
  supplierInvoiceNo: z.string().max(80).nullish(),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the invoice date.'),
  vatTreatment: z.enum(['DOMESTIC', 'EU_REVERSE', 'IMPORT', 'NONE']),
  shippingCents: money,
  otherFeesCents: money,
  vatCents: money.nullish(),
  note: z.string().max(2000).nullish(),
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid().nullable(),
        description: z.string().max(300).nullish(),
        quantity: z.number().int().min(0).max(1_000_000),
        freeQuantity: z.number().int().min(0).max(1_000_000).optional(),
        unitNetCents: money,
      }),
    )
    .min(1, 'Add at least one product.')
    .max(500),
  receive: z.boolean().optional(),
})

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date.')
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.')

export const expenseSchema = z.object({
  expenseDate: day,
  categoryId: z.string().uuid('Choose a category.'),
  payee: z.string().trim().min(1, 'Who was it paid to?').max(160),
  description: z.string().max(300).nullish(),
  reference: z.string().max(80).nullish(),
  vatTreatment: z.enum(['DOMESTIC', 'EU_REVERSE', 'NONE']),
  netCents: money,
  vatCents: money.nullish(),
  paymentMethod: z.enum(['bank', 'card', 'cash', 'other']).nullish(),
})

export const recurringSchema = z.object({
  categoryId: z.string().uuid('Choose a category.'),
  payee: z.string().trim().min(1, 'Who is it paid to?').max(160),
  description: z.string().max(300).nullish(),
  vatTreatment: z.enum(['DOMESTIC', 'EU_REVERSE', 'NONE']),
  netCents: money,
  vatCents: money.nullish(),
  paymentMethod: z.enum(['bank', 'card', 'cash', 'other']).nullish(),
  dayOfMonth: z.number().int().min(1).max(28),
  startMonth: monthStr,
  endMonth: monthStr.nullish(),
  isActive: z.boolean().optional(),
})

export const retailerSchema = z.object({
  name: z.string().trim().min(1, 'Give the retailer a name.').max(160),
  contactName: z.string().max(120).nullish(),
  email: z.union([z.literal(''), z.string().email('That email does not look right.')]).nullish(),
  phone: z.string().max(40).nullish(),
  vatNumber: z.string().max(40).nullish(),
  taxId: z.string().max(40).nullish(),
  address: z.string().max(1000).nullish(),
  country: z.string().trim().length(2),
  vatTreatment: z.enum(['DOMESTIC', 'EU_ZERO']),
  defaultDiscountPercent: z.number().min(0).max(90),
  paymentTermsDays: z.number().int().min(0).max(365),
  note: z.string().max(2000).nullish(),
  isActive: z.boolean().optional(),
})

export const saleSchema = z.object({
  retailerId: z.string().uuid('Choose the retailer.'),
  saleDate: day,
  note: z.string().max(1000).nullish(),
  paidNow: z.object({ method: z.enum(['bank', 'card', 'cash', 'other']) }).nullish(),
  lines: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(0).max(1_000_000), unitNetCents: money }))
    .min(1, 'Add at least one product.')
    .max(500),
})
