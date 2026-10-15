/* ============================================================================
 * The audit trail: who changed what, when.
 *
 * Written for owner decisions that change what customers see — a product
 * hidden, marked sold out, repriced; a campaign sent; a conversation closed.
 * Never allowed to break the change it records: a failed audit write is
 * logged and swallowed.
 * ========================================================================== */

import { db } from '@/db'
import { auditLog } from '@/db/schema'

export async function audit(entry: {
  actor: { id: string; email: string } | null
  action: string
  entity: string
  entityId?: string | null
  diff?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorId: entry.actor?.id ?? null,
      actorEmail: entry.actor?.email ?? null,
      action: entry.action.slice(0, 80),
      entity: entry.entity.slice(0, 60),
      entityId: entry.entityId ?? null,
      diff: entry.diff ?? null,
    })
  } catch (err) {
    console.error('[audit] could not record', entry.action, err)
  }
}
