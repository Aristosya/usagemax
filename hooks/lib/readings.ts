import type { SessionUsage } from 'claude-code'

import type { Reading, SessionFile } from '../../types'

/** The limit windows `$.session.usage()` reported, as one reading; windows without a reset time are left out. */
export function readingFrom(u: SessionUsage, at: number): Reading {
  const r: Reading = { at }
  for (const l of u.rateLimits) {
    if ((l.kind === 'five_hour' || l.kind === 'seven_day') && l.resetsAt) r[l.kind] = { pct: l.percentUsed, resetsAt: l.resetsAt }
  }
  return r
}

/** A plan without the 5-hour window reports the week alone. */
export function weekOnly(r: Reading | null | undefined): boolean {
  return r != null && r.five_hour === undefined && r.seven_day !== undefined
}

/**
 * The newest reading of any chat by `now`: each finished request's last one, and the one a running request
 * measured when a window moved. A chat's running reading counts for the account it ran under.
 */
export function newestReading(files: readonly SessionFile[], now: number, account?: string): Reading | null {
  let best: Reading | null = null
  // A running request's reading comes after the last finished one, so it wins a tie.
  const consider = (r: Reading | null | undefined, winsTie: boolean) => {
    if (!r || r.at > now || (r.five_hour === undefined && r.seven_day === undefined)) return
    if (best === null || r.at > best.at || (winsTie && r.at === best.at)) best = r
  }
  for (const f of files) for (const t of f.turns) consider(t.readings.after, false)
  for (const f of files) if (f.live && (account === undefined || f.live.account === account)) consider(f.live.reading, true)
  return best
}
