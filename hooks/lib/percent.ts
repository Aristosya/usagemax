import type { PctValue, Rate, Reading, TurnPct, TurnRecord, WindowKind, WindowReading } from '../../types'

const WINDOWS: readonly WindowKind[] = ['five_hour', 'seven_day']
const SAME_WINDOW_MS = 60_000
const CALIBRATION_MS = 7 * 86_400_000
/** Points of growth a rate needs before it is trusted; readings move in whole points. */
const READY_POINTS: Record<WindowKind, number> = { five_hour: 5, seven_day: 3 }
/** A raw delta is shown only when it spans this many reading steps. */
const RAW_STEPS = 10

/** Two readings of one window: their reset times differ by a minute at most. */
export function sameWindow(a: WindowReading, b: WindowReading): boolean {
  return Math.abs(Date.parse(a.resetsAt) - Date.parse(b.resetsAt)) <= SAME_WINDOW_MS
}

/** Growth of a window between two readings; a new window counts from zero. */
export function rawDelta(before: WindowReading | undefined, after: WindowReading | undefined): number | null {
  if (!before || !after) return null
  return sameWindow(before, after) ? Math.max(0, after.pct - before.pct) : after.pct
}

function windowPercent(
  w: WindowKind,
  i: { before: Reading | null; after: Reading | null; units: number; isParallel: boolean; rate: Rate; step: number },
): PctValue | null {
  const after = i.after?.[w]
  if (!after) return null
  const before = i.before?.[w]
  const raw = rawDelta(before, after)
  const isLarge = raw !== null && raw >= RAW_STEPS * i.step
  if (isLarge && !i.isParallel && before && sameWindow(before, after)) return { v: raw, mode: 'exact' }
  const rate = i.rate[w]
  if (rate !== null) return { v: i.units * rate, mode: 'estimate' }
  return isLarge ? { v: raw, mode: 'raw' } : null
}

/** How much of each limit window one request used: exact, estimated from the rate, or raw. */
export function turnPercent(i: {
  before: Reading | null
  after: Reading | null
  units: number
  isParallel: boolean
  rate: Rate
  step: number
}): TurnPct {
  return { five_hour: windowPercent('five_hour', i), seven_day: windowPercent('seven_day', i) }
}

/**
 * Percent per cost unit for the whole account over the last 7 days: the window's growth along the
 * timeline of every chat's end-of-turn readings, divided by the cost of every request in that span.
 *
 * Readings move in whole points, so a single request's own delta mostly shows a counter crossing a
 * point that other chats filled. Taking all requests together lets those crossings add up to the
 * real growth (a rate from "solo" requests alone came out 8-12 times too high on real data).
 */
export function calibrate(turns: readonly TurnRecord[], now: number): Rate {
  const rate: Rate = { five_hour: null, seven_day: null }
  const recent = turns.filter(t => t.endedAt >= now - CALIBRATION_MS && t.endedAt <= now)
  for (const w of WINDOWS) {
    const points = recent
      .map(t => ({ at: t.readings.after?.at ?? 0, r: t.readings.after?.[w] }))
      .filter((p): p is { at: number; r: WindowReading } => p.r !== undefined)
      .sort((a, b) => a.at - b.at)
    const first = points[0]
    const last = points.at(-1)
    if (!first || !last || first.at === last.at) continue
    let growth = 0
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1]?.r
      const next = points[i]?.r
      if (prev && next) growth += sameWindow(prev, next) ? Math.max(0, next.pct - prev.pct) : next.pct
    }
    const units = recent.filter(t => t.endedAt > first.at && t.endedAt <= last.at).reduce((sum, t) => sum + t.units, 0)
    if (growth >= READY_POINTS[w] && units > 0) rate[w] = growth / units
  }
  return rate
}
