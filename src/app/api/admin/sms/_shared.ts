import { z } from 'zod'

export const audienceSchema = z.enum(['all', 'en', 'el', 'ru'])
export const textSchema = z.string().trim().min(5, 'Write the message first.').max(1000)
