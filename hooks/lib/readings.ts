import type { SessionUsage } from 'claude-code'

import type { Reading } from '../../types'

/** The limit windows `$.session.usage()` reported, as one reading; windows without a reset time are left out. */
export function readingFrom(u: SessionUsage, at: number): Reading {
  const r: Reading = { at }
  for (const l of u.rateLimits) {
    if ((l.kind === 'five_hour' || l.kind === 'seven_day') && l.resetsAt) r[l.kind] = { pct: l.percentUsed, resetsAt: l.resetsAt }
  }
  return r
}
