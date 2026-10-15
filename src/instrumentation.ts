/* ============================================================================
 * Runs once when the server starts (Next.js instrumentation hook).
 *
 * Starts the automation clock (lib/automations.ts runAutomations): every 30
 * seconds, quiet Customer Service conversations are closed (transcripts
 * emailed), due automated emails are sent and scheduled campaigns start.
 * Node runtime only; never in the edge runtime or during a build. A failed
 * tick is logged and the next one tries again. SUPPORT_SWEEP=off (or
 * AUTOMATIONS=off) turns it off, e.g. for tests that drive it themselves.
 * ========================================================================== */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.SUPPORT_SWEEP === 'off' || process.env.AUTOMATIONS === 'off') return

  const g = globalThis as typeof globalThis & { __supportSweep?: ReturnType<typeof setInterval> }
  if (g.__supportSweep) return /* dev hot-reload: one timer, not one per reload */

  const { runAutomations } = await import('@/lib/automations')
  let running = false
  g.__supportSweep = setInterval(() => {
    if (running) return
    running = true
    runAutomations()
      .catch((err) => console.error('[automations] tick failed:', err instanceof Error ? err.message : err))
      .finally(() => {
        running = false
      })
  }, 30_000)
  g.__supportSweep.unref?.()
}
