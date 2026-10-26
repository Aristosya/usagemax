import type { Severity, Tokens } from '../../types'

/** Share of the 5-hour window: one decimal, `<0.1%` below that. */
export function formatPct5h(v: number): string {
  return v < 0.1 ? '<0.1%' : `+${v.toFixed(1)}%`
}

/** Share of the weekly window: two decimals, `<0.01%` below that. */
export function formatPctWeek(v: number): string {
  return v < 0.01 ? '<0.01%' : `+${v.toFixed(2)}%`
}

export function formatTok(n: number): string {
  if (n < 1000) return String(Math.round(n))
  const thousands = Math.round(n / 1000)
  if (thousands < 1000) return `${thousands}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** Tokens a request sent or wrote: cache reads are cheap and left out. */
export function visibleTokens(t: Tokens): number {
  return t.in + t.cacheWrite + t.out
}

export function severity(pct5h: number | null): Severity {
  if (pct5h === null) return 'normal'
  if (pct5h >= 6) return 'alert'
  if (pct5h >= 3) return 'warn'
  return 'normal'
}

/** A share nobody can tell yet: the rate is not ready and the delta is too small to show. */
const UNKNOWN = '–'

/**
 * The line under an answer: `Used: +0.3%/+0.01% 9K Tok · 2.1M cached`, `–` for an unknown share, `Used: 9K Tok`
 * when both are unknown. Cache reads stand apart: they are most of a long chat's cost, yet cheap per token.
 */
export function footerText(p: { pct5h: number | null; pctWeek: number | null; tok: number; cached?: number }): string {
  const tok = `${formatTok(p.tok)} Tok${p.cached !== undefined && p.cached > 0 ? ` · ${formatTok(p.cached)} cached` : ''}`
  if (p.pct5h === null && p.pctWeek === null) return `Used: ${tok}`
  const five = p.pct5h === null ? UNKNOWN : formatPct5h(p.pct5h)
  const week = p.pctWeek === null ? UNKNOWN : formatPctWeek(p.pctWeek)
  return `Used: ${five}/${week} ${tok}`
}
