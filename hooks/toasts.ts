import type { EngineInterface, On } from 'claude-code'

import type { Forecast, Rate, Reading, SessionFile } from '../types'
import { formatPct5h } from './lib/format'
import { type MsgKey, langOf, t } from './lib/i18n'
import { readingFrom } from './lib/readings'
import { forecast } from './lib/report'
import { clock } from './panel'

/** `$.store` key of the toasts already shown, as `<kind>:<window resetsAt>`. */
const STORE_KEY = 'toasts'

const MESSAGE: Readonly<Record<string, MsgKey>> = { '5h80': 'toast.5h80', '5h90': 'toast.5h90', wk80: 'toast.wk80', runout: 'toast.runout' }

/** A window's reset time to the minute: one window arrives with different milliseconds. */
function windowKey(resetsAt: string): string {
  const ms = Date.parse(resetsAt)
  return Number.isNaN(ms) ? resetsAt : new Date(Math.round(ms / 60_000) * 60_000).toISOString()
}

/** Toasts this reading calls for that were not shown in the same window yet. */
export function toastsDue(fired: readonly string[], r: Reading, f: Forecast): string[] {
  const due: string[] = []
  const five = r.five_hour ? windowKey(r.five_hour.resetsAt) : null
  const week = r.seven_day ? windowKey(r.seven_day.resetsAt) : null
  if (five !== null && (r.five_hour?.pct ?? 0) >= 80) due.push(`5h80:${five}`)
  if (five !== null && (r.five_hour?.pct ?? 0) >= 90) due.push(`5h90:${five}`)
  if (week !== null && (r.seven_day?.pct ?? 0) >= 80) due.push(`wk80:${week}`)
  if (five !== null && f.kind === 'runsOutAt') due.push(`runout:${five}`)
  return due.filter(key => !fired.includes(key))
}

async function fireToasts($: EngineInterface, r: Reading, f: Forecast): Promise<void> {
  const stored = await $.store.get(STORE_KEY)
  const fired = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
  const due = toastsDue(fired, r, f)
  if (due.length === 0) return
  const lang = await langOf($)
  const time = f.kind === 'runsOutAt' ? clock(f.at, -new Date(r.at).getTimezoneOffset()) : ''
  for (const key of due) {
    const message = MESSAGE[key.slice(0, key.indexOf(':'))]
    if (message !== undefined) $.ui.toast(t(lang, message, { time }))
  }
  const live = new Set([r.five_hour && windowKey(r.five_hour.resetsAt), r.seven_day && windowKey(r.seven_day.resetsAt)])
  await $.store.set(STORE_KEY, [...fired, ...due].filter(key => live.has(key.slice(key.indexOf(':') + 1))))
}

/** `$.store` key of the hungry-chat toasts shown, as `<sessionId>:<clock hour>`. */
const HUNGRY_KEY = 'hungry'
const HUNGRY_PCT = 10
const HOUR = 3_600_000

/** This chat's share of the 5-hour window over the last hour, by cost × rate; null without a rate. */
export function lastHourShare(file: SessionFile, rate: Rate, now: number): number | null {
  if (rate.five_hour === null) return null
  return file.turns.filter(x => x.endedAt > now - HOUR && x.endedAt <= now).reduce((sum, x) => sum + x.units, 0) * rate.five_hour
}

/** Once per clock hour: a toast when this chat ate more than 10% of the 5-hour window in the last hour. */
export async function hungryToast($: EngineInterface, file: SessionFile, rate: Rate, now: number): Promise<void> {
  const share = lastHourShare(file, rate, now)
  if (share === null || share < HUNGRY_PCT) return
  const key = `${file.sessionId}:${Math.floor(now / HOUR)}`
  const stored = await $.store.get(HUNGRY_KEY)
  const shown = Array.isArray(stored) ? stored.filter((x): x is string => typeof x === 'string') : []
  if (shown.includes(key)) return
  const title = file.title !== '' ? file.title : (file.turns[0]?.prompt ?? '').slice(0, 40)
  $.ui.toast(t(await langOf($), 'toast.hungry', { title, pct: formatPct5h(share).replace('+', '') }))
  await $.store.set(HUNGRY_KEY, [...shown, key].slice(-50))
}

/** After a turn: limit thresholds, and the run-out forecast from this chat's readings. */
export async function toastsAfterTurn($: EngineInterface, file: SessionFile, current: Reading | null): Promise<void> {
  if (current === null) return
  const readings = file.turns.flatMap(x => [x.readings.before, x.readings.after]).filter((x): x is Reading => x !== null)
  await fireToasts($, current, forecast([...readings, current], current.at))
}

/** Limit thresholds also fire when a window moves outside a turn of this chat. */
export function toasts(on: On): void {
  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await fireToasts($, readingFrom({ startedAt: 0, context: e.context, rateLimits: e.rateLimits }, await $.clock.now()), { kind: 'unknown' })
    return r
  })
}
