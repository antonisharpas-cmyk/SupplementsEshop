/* The membership tier as a badge: one look per tier, from the brand's own
   black, silver and gold. Used on the account, product cards and pages, the
   bag, and in the admin. */

const LOOK: Record<string, { cls: string; icon: string }> = {
  basic: { cls: 'border border-line-strong bg-paper-2 text-ink-soft', icon: '◆' },
  performer: { cls: 'bg-silver text-black', icon: '◆' },
  elite: { cls: 'border border-accent/70 bg-accent/10 text-accent', icon: '◆◆' },
  champion: { cls: 'bg-gold text-black shadow-[0_6px_18px_-10px_rgb(242_183_5/0.8)]', icon: '◆◆◆' },
  pro: { cls: 'border border-accent bg-black text-accent shadow-[0_0_0_1px_rgb(255_212_59/0.25),0_8px_24px_-12px_rgb(242_183_5/0.9)]', icon: '★' },
}

const NAMES: Record<string, string> = { basic: 'Basic', performer: 'Performer', elite: 'Elite', champion: 'Champion', pro: 'Pro' }

export function TierBadge({
  tier,
  suffix,
  size = 'sm',
}: {
  tier: string
  /** Extra words after the name, e.g. "−12%". */
  suffix?: string
  size?: 'xs' | 'sm' | 'lg'
}) {
  const look = LOOK[tier] ?? LOOK.basic
  const pad = size === 'lg' ? 'px-4 py-1.5 text-sm' : size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold uppercase tracking-[0.12em] ${pad} ${look.cls}`}>
      <span aria-hidden className="text-[0.85em] tracking-tight">
        {look.icon}
      </span>
      {NAMES[tier] ?? tier}
      {suffix && <span className="font-medium normal-case tracking-normal opacity-80">{suffix}</span>}
    </span>
  )
}
