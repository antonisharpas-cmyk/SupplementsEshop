/* Small helpers every JSON route uses: one response shape, one way to read a
   body, one way to turn a zod failure into a sentence. */

import type { z } from 'zod'

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export const fail = (status: number, error: string, message?: string, extra: Record<string, unknown> = {}) =>
  json({ ok: false, error, message, ...extra }, status)

export async function readJson<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: Response }> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { response: fail(400, 'INVALID_JSON', 'That request was not readable.') }
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const fields: Record<string, string> = {}
    for (const i of parsed.error.issues) {
      const key = i.path.join('.')
      if (key && !fields[key]) fields[key] = i.message
    }
    return { response: fail(422, 'INVALID_INPUT', issue?.message ?? 'That was not valid.', { fields }) }
  }
  return { data: parsed.data }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
