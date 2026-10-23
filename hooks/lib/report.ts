import type { Bounds, Forecast, Period, Rate, Reading, SessionFile, SessionSummary, TopRow, TurnRecord, WindowKind, WindowReading } from '../../types'
import { visibleTokens } from './format'
import { sameWindow } from './percent'

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** How far back each forecast reads, how much of that it needs, and how many whole points of growth. */
const FIVE_FORECAST = { spanMs: 30 * 60_000, minCoverMs: 15 * 60_000, minPoints: 2 }
const WEEK_FORECAST = { spanMs: DAY, minCoverMs: 6 * HOUR, minPoints: 3 }
const TITLE_CHARS = 40

/** The period's start and end; `tzOffsetMin` is minutes east of UTC. */
export function periodBounds(p: Period, now: number, tzOffsetMin: number, current: Reading | null): Bounds {
  const local = now + tzOffsetMin * 60_000
  const midnight = local - (((local % DAY) + DAY) % DAY) - tzOffsetMin * 60_000
  if (p === 'hour') return { from: now - HOUR, to: now }
  if (p === 'yesterday') return { from: midnight - DAY, to: midnight - 1 }
  if (p === 'window5h' && current?.five_hour) return { from: Date.parse(current.five_hour.resetsAt) - 5 * HOUR, to: now }
  if (p === 'week') return { from: current?.seven_day ? Date.parse(current.seven_day.resetsAt) - 7 * DAY : now - 7 * DAY, to: now }
  return { from: midnight, to: now }
}

const inside = (at: number, b: Bounds): boolean => at >= b.from && at <= b.to
/**
 * A request's share of a window: its cost times the account rate. The percent each chat saved for
 * itself is not used: chats on older builds saved shares from a rate 8-12 times too high.
 */
const share = (t: TurnRecord, w: WindowKind, rate: Rate): number => t.units * (rate[w] ?? 0)

/** The share a period is told in: a day or a week spans several 5-hour windows, so it shows the weekly share. */
export function shareKey(p: Period): 'pct5h' | 'pctWeek' {
  return p === 'today' || p === 'yesterday' || p === 'week' ? 'pctWeek' : 'pct5h'
}
const turnTokens = (t: TurnRecord): number => visibleTokens(t.tokens) + visibleTokens(t.agents.tokens)

function unknownOf(rate: Rate): { five_hour?: true; seven_day?: true } | undefined {
  if (rate.five_hour !== null && rate.seven_day !== null) return undefined
  return { ...(rate.five_hour === null ? { five_hour: true as const } : {}), ...(rate.seven_day === null ? { seven_day: true as const } : {}) }
}

function titleOf(file: SessionFile): string {
  return file.title !== '' ? file.title : (file.turns[0]?.prompt ?? file.sessionId).slice(0, TITLE_CHARS)
}

/**
 * Window growth no Code chat explains (the Chat tab, the phone, another computer): the growth along
 * the end-of-turn readings of the period minus the shares of the requests in that span; null without a rate.
 */
export function otherShare(files: readonly SessionFile[], b: Bounds, w: WindowKind, rate: Rate): number | null {
  if (rate[w] === null) return null
  const turns = files.flatMap(f => f.turns)
  const points = turns
    .map(t => ({ at: t.readings.after?.at ?? 0, r: t.readings.after?.[w] }))
    .filter((x): x is { at: number; r: WindowReading } => x.r !== undefined && inside(x.at, b))
    .sort((a, c) => a.at - c.at)
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last || first.at === last.at) return 0
  let growth = 0
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]?.r
    const next = points[i]?.r
    if (prev && next) growth += sameWindow(prev, next) ? Math.max(0, next.pct - prev.pct) : next.pct
  }
  const code = turns.filter(t => t.endedAt > first.at && t.endedAt <= last.at).reduce((sum, t) => sum + share(t, w, rate), 0)
  return Math.max(0, growth - code)
}

/** Chats by how much of the limit they used in the period, each with its heaviest request; other usage is a row. */
export function topChats(files: readonly SessionFile[], p: Period, b: Bounds, otherTitle: string, rate: Rate): TopRow[] {
  const key = shareKey(p)
  const unknown = unknownOf(rate)
  const rows: TopRow[] = []
  for (const file of files) {
    const turns = file.turns.filter(t => inside(t.endedAt, b))
    if (turns.length === 0) continue
    const row: TopRow = { id: file.sessionId, title: titleOf(file), pct5h: 0, pctWeek: 0, tokens: 0, heaviest: null, ...(unknown ? { unknown } : {}) }
    let top: TurnRecord | null = null
    for (const t of turns) {
      row.pct5h += share(t, 'five_hour', rate)
      row.pctWeek += share(t, 'seven_day', rate)
      row.tokens += turnTokens(t)
      if (top === null || t.units > top.units) top = t
    }
    if (top) row.heaviest = { prompt: top.prompt, pct5h: share(top, 'five_hour', rate), pctWeek: share(top, 'seven_day', rate), at: top.endedAt }
    rows.push(row)
  }
  const five = otherShare(files, b, 'five_hour', rate)
  const week = otherShare(files, b, 'seven_day', rate)
  if ((five ?? 0) > 0 || (week ?? 0) > 0) {
    rows.push({ id: 'other', title: otherTitle, pct5h: five ?? 0, pctWeek: week ?? 0, tokens: 0, heaviest: null, ...(unknown ? { unknown } : {}) })
  }
  return rows.sort((a, c) => c[key] - a[key] || c.tokens - a.tokens)
}

/** This chat in the current windows: its share, requests, tokens, last 10 requests and the heaviest one. */
export function sessionSummary(file: SessionFile, current: Reading | null, rate: Rate): SessionSummary {
  const inWindow = (t: TurnRecord, w: WindowKind): boolean => {
    const now = current?.[w]
    const at = t.readings.after?.[w]
    return now === undefined || (at !== undefined && sameWindow(at, now))
  }
  const five = file.turns.filter(t => inWindow(t, 'five_hour'))
  const week = file.turns.filter(t => inWindow(t, 'seven_day'))
  let heaviest: TurnRecord | null = null
  for (const t of five) if (heaviest === null || t.units > heaviest.units) heaviest = t
  const unknown = unknownOf(rate)
  return {
    pct5h: five.reduce((s, t) => s + share(t, 'five_hour', rate), 0),
    pctWeek: week.reduce((s, t) => s + share(t, 'seven_day', rate), 0),
    count: five.length,
    tokens: five.reduce((s, t) => s + turnTokens(t), 0),
    last: [...file.turns].sort((a, c) => c.endedAt - a.endedAt).slice(0, 10),
    heaviest,
    ...(unknown ? { unknown } : {}),
  }
}

/** When the 5-hour window runs out at the pace of the last 30 minutes (15 of them at least), if before it resets. */
export function forecast(readings: readonly Reading[], now: number): Forecast {
  return windowForecast(readings, now, 'five_hour', FIVE_FORECAST)
}

/**
 * When the week runs out at the pace of the last day (6 hours of it at least), if before it resets.
 * A day takes in the idle hours a working stretch leaves out; minutes after a reset say nothing.
 */
export function weekForecast(readings: readonly Reading[], now: number): Forecast {
  return windowForecast(readings, now, 'seven_day', WEEK_FORECAST)
}

function windowForecast(readings: readonly Reading[], now: number, kind: WindowKind, o: typeof FIVE_FORECAST): Forecast {
  const points = readings
    .map(r => ({ at: r.at, w: r[kind] }))
    .filter((p): p is { at: number; w: WindowReading } => p.w !== undefined)
    .sort((a, c) => a.at - c.at)
  const last = points.at(-1)
  if (!last) return { kind: 'unknown' }
  const span = points.filter(p => p.at >= now - o.spanMs && sameWindow(p.w, last.w))
  const first = span[0]
  // A window that reset a moment ago has a few minutes of readings: their pace is noise.
  if (!first || last.at - first.at < o.minCoverMs) return { kind: 'unknown' }
  const growth = last.w.pct - first.w.pct
  if (growth <= 0) return { kind: 'lasts' }
  // Readings move in whole points: a point or two of growth says little about the pace.
  if (growth < o.minPoints) return { kind: 'unknown' }
  const slope = growth / (last.at - first.at)
  const at = now + (100 - last.w.pct) / slope
  return at < Date.parse(last.w.resetsAt) ? { kind: 'runsOutAt', at: Math.round(at) } : { kind: 'lasts' }
}
