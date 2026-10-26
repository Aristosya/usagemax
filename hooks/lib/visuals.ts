import type { Bounds, DayCost, ModelShare, Pace, SessionFile, WindowReading } from '../../types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const WINDOW_5H = 5 * HOUR
const DAYS = 7
/** Points the window may run ahead of or behind the clock before the pace is called fast or slow. */
const PACE_SLACK = 5
const TREND = '▁▂▃▄▅▆▇█'
/** A non-breaking space: a plain one may collapse to nothing on the desktop and shift the columns. */
export const NBSP = String.fromCharCode(0xa0)

/** Local midnight of the day `at` falls in; `tz` is minutes east of UTC. */
function localMidnight(at: number, tz: number): number {
  const local = at + tz * 60_000
  return local - (((local % DAY) + DAY) % DAY) - tz * 60_000
}

/** Cost per local day for the last 7 days, oldest first, today last. */
export function dailyCost(files: readonly SessionFile[], now: number, tz: number): DayCost[] {
  const today = localMidnight(now, tz)
  const days: DayCost[] = Array.from({ length: DAYS }, (_, i) => {
    const start = today - (DAYS - 1 - i) * DAY
    return { start, weekday: new Date(start + tz * 60_000 + HOUR).getUTCDay(), units: 0 }
  })
  for (const t of files.flatMap(f => f.turns)) {
    const index = Math.floor((t.endedAt - days[0]!.start) / DAY)
    const day = days[index]
    if (day && t.endedAt <= now) day.units += t.units
  }
  return days
}

/** Cost per local hour for the last 7 days: 7 rows of 24, oldest day first. */
export function hourlyGrid(files: readonly SessionFile[], now: number, tz: number): number[][] {
  const first = localMidnight(now, tz) - (DAYS - 1) * DAY
  const grid = Array.from({ length: DAYS }, () => Array.from({ length: 24 }, () => 0))
  for (const t of files.flatMap(f => f.turns)) {
    if (t.endedAt < first || t.endedAt > now) continue
    const offset = t.endedAt - first
    const row = grid[Math.floor(offset / DAY)]
    const hour = Math.floor((offset % DAY) / HOUR)
    if (row && row[hour] !== undefined) row[hour] += t.units
  }
  return grid
}

/** 0 for an idle hour, then 1-3 by thirds of the busiest hour. */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 {
  if (value <= 0 || max <= 0) return 0
  const ratio = value / max
  if (ratio <= 1 / 3) return 1
  if (ratio <= 2 / 3) return 2
  return 3
}

/** The hour axis as 24 one-character cells: labels at 0, 6, 12, 18 and 23 sit in their own columns. */
export function axisCells(): string[] {
  const cells = Array.from({ length: 24 }, () => NBSP)
  const put = (col: number, label: string) => [...label].forEach((c, i) => (cells[col + i] = c))
  put(0, '0')
  put(6, '6')
  put(12, '12')
  put(18, '18')
  put(22, '23')
  return cells
}

/** A bar for the trend, from `▁` (idle) to `█` (the busiest day). */
export function trendGlyph(value: number, max: number): string {
  if (max <= 0) return TREND[0]!
  const index = Math.round(Math.min(1, Math.max(0, value / max)) * (TREND.length - 1))
  // A day with any cost stands above an idle one.
  return TREND[value > 0 ? Math.max(1, index) : index]!
}

/** Cost by model in the period, biggest first. */
export function modelSplit(files: readonly SessionFile[], b: Bounds): ModelShare[] {
  const by = new Map<string, number>()
  for (const t of files.flatMap(f => f.turns)) {
    if (t.endedAt < b.from || t.endedAt > b.to || t.units <= 0) continue
    by.set(t.model, (by.get(t.model) ?? 0) + t.units)
  }
  const total = [...by.values()].reduce((s, u) => s + u, 0)
  return [...by.entries()]
    .map(([model, units]) => ({ model, units, share: total > 0 ? units / total : 0 }))
    .sort((a, c) => c.units - a.units)
}

/**
 * Widths of the model bar's runs by largest remainder: they add up to `width` exactly and the biggest
 * model keeps its share however many small ones there are.
 */
export function modelBar(models: readonly ModelShare[], width: number): number[] {
  const exact = models.map(m => m.share * width)
  const widths = exact.map(Math.floor)
  let left = width - widths.reduce((s, w) => s + w, 0)
  const order = exact.map((e, i) => ({ i, rest: e - Math.floor(e) })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    widths[i] = (widths[i] ?? 0) + 1
    left -= 1
  }
  return widths
}

/** `claude-opus-5-5` → `Opus 5.5`; anything else stays as it is. */
export function modelName(model: string): string {
  // A minor version is one or two digits; `-20250514` is a date, not a version.
  const m = /^(?:anthropic\.)?claude-([a-z]+)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(model)
  if (!m?.[1] || !m[2]) return model
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return `${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

/** How full the 5-hour window is against how much of its time has passed; null once it reset or without a reset time. */
export function paceOf(w: WindowReading, now: number, windowMs = WINDOW_5H): Pace | null {
  const resetsAt = Date.parse(w.resetsAt)
  if (Number.isNaN(resetsAt) || resetsAt <= now) return null
  const start = resetsAt - windowMs
  const elapsed = Math.round(Math.min(100, Math.max(0, ((now - start) / windowMs) * 100)))
  const verdict = w.pct > elapsed + PACE_SLACK ? 'faster' : w.pct < elapsed - PACE_SLACK ? 'slower' : 'onPace'
  return { used: w.pct, elapsed, verdict }
}
