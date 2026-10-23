import { expect, test } from 'claude-code/testing'

import { forecast, otherShare, periodBounds, sessionSummary, topChats, weekForecast } from '../hooks/lib/report'
import { DAY, WINDOW_A, WINDOW_B, reading, session, turn } from './factory'
import { expectNear } from './near'

const MIN = 60_000
const RATE = { five_hour: 1, seven_day: 0.1 }
const NO_RATE = { five_hour: null, seven_day: null }

const files = [
  session({
    sessionId: 'a',
    title: 'Auth refactor',
    turns: [
      turn({ turnId: 'a1', startedAt: 10 * MIN, endedAt: 11 * MIN, prompt: 'rename the token check', units: 1 }),
      turn({ turnId: 'a2', startedAt: 20 * MIN, endedAt: 21 * MIN, prompt: 'rewrite the login flow', units: 3 }),
    ],
  }),
  session({
    sessionId: 'b',
    title: 'API docs',
    turns: [turn({ turnId: 'b1', startedAt: 30 * MIN, endedAt: 31 * MIN, prompt: 'document the endpoints', units: 2 })],
  }),
]
const bounds = { from: 0, to: 60 * MIN }

test('ranks chats by their cost times the account rate', () => {
  const rows = topChats(files, 'hour', bounds, 'Other', RATE)
  expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  expectNear(rows[0]?.pct5h, 4)
  expectNear(rows[0]?.pctWeek, 0.4)
  expect(rows[0]?.heaviest?.prompt).toBe('rewrite the login flow')
  expect(rows[0]?.title).toBe('Auth refactor')
})

test('ignores the percent each chat saved for itself', () => {
  const saved = [session({ sessionId: 'a', turns: [turn({ units: 1, pct: { five_hour: { v: 160, mode: 'estimate' }, seven_day: { v: 56, mode: 'estimate' } } })] })]
  const [row] = topChats(saved, 'today', { from: 0, to: 10_000 }, 'Other', RATE)
  expectNear(row?.pct5h, 1)
  expectNear(row?.pctWeek, 0.1)
})

test('names an untitled chat by its first request', () => {
  const rows = topChats([session({ sessionId: 'c', title: '', turns: [turn({ prompt: 'x'.repeat(60) })] })], 'hour', { from: 0, to: 10_000 }, 'Other', RATE)
  expect(rows[0]?.title).toBe('x'.repeat(40))
})

test('puts other usage in its own row', () => {
  const withReadings = [
    session({
      sessionId: 'a',
      turns: [
        turn({ startedAt: 1 * MIN, endedAt: 2 * MIN, units: 4, readings: { before: reading(1 * MIN, 10, 20), after: reading(2 * MIN, 14, 20) } }),
        turn({ turnId: 't2', startedAt: 5 * MIN, endedAt: 6 * MIN, units: 3, readings: { before: reading(5 * MIN, 1, 20), after: reading(6 * MIN, 20, 20) } }),
      ],
    }),
  ]
  expectNear(otherShare(withReadings, bounds, 'five_hour', RATE), 3)
  const rows = topChats(withReadings, 'hour', bounds, 'Other', RATE)
  expect(rows.map(r => r.id)).toEqual(['a', 'other'])
  expect(rows[1]?.title).toBe('Other')
})

test('marks shares unknown until the rate is ready', () => {
  const two = [
    session({
      sessionId: 'a',
      turns: [
        turn({ startedAt: 1 * MIN, endedAt: 2 * MIN, units: 1, readings: { before: null, after: reading(2 * MIN, 10, 20) } }),
        turn({ turnId: 't2', startedAt: 3 * MIN, endedAt: 4 * MIN, units: 2, readings: { before: null, after: reading(4 * MIN, 15, 21) } }),
      ],
    }),
  ]
  expect(otherShare(two, bounds, 'five_hour', NO_RATE)).toBeNull()
  const rows = topChats(two, 'today', bounds, 'Other', NO_RATE)
  expect(rows.map(r => r.id)).toEqual(['a'])
  expect(rows[0]?.unknown).toEqual({ five_hour: true, seven_day: true })
  const half = topChats(two, 'today', bounds, 'Other', { five_hour: 1, seven_day: null })
  const other = half.find(r => r.id === 'other')
  expectNear(other?.pct5h, 3)
  expect(other?.unknown).toEqual({ seven_day: true })
})

test('never shows negative other usage', () => {
  const over = [session({ turns: [turn({ endedAt: 1, readings: { before: null, after: reading(1, 10, 20) } }), turn({ turnId: 't2', endedAt: 2, units: 5, readings: { before: null, after: reading(2, 11, 20) } })] })]
  expect(otherShare(over, { from: 0, to: 10_000 }, 'five_hour', RATE)).toBe(0)
})

test('counts a new window from zero', () => {
  const reset = [
    session({
      turns: [
        turn({ startedAt: 1, endedAt: 2, units: 2, readings: { before: null, after: reading(2, 92, 20, WINDOW_A) } }),
        turn({ turnId: 't2', startedAt: 3, endedAt: 4, units: 1, readings: { before: null, after: reading(4, 6, 20, WINDOW_B) } }),
      ],
    }),
  ]
  expectNear(otherShare(reset, { from: 0, to: 10 }, 'five_hour', RATE), 5)
})

test('bounds today at local midnight', () => {
  const now = 10 * DAY + 3 * 3_600_000
  expect(periodBounds('today', now, 240, null)).toEqual({ from: 10 * DAY - 4 * 3_600_000, to: now })
  expect(periodBounds('yesterday', now, 240, null)).toEqual({ from: 9 * DAY - 4 * 3_600_000, to: 10 * DAY - 4 * 3_600_000 - 1 })
  expect(periodBounds('hour', now, 0, null)).toEqual({ from: now - 3_600_000, to: now })
})

test('bounds the 5h window and the week by their reset times', () => {
  const now = Date.parse('2026-10-22T08:00:00.000Z')
  const current = reading(now, 40, 20)
  expect(periodBounds('window5h', now, 0, current).from).toBe(Date.parse(WINDOW_A) - 5 * 3_600_000)
  expect(periodBounds('week', now, 0, current).from).toBe(Date.parse('2026-10-21T03:00:00.000Z'))
})

test('summarises this session in the current window', () => {
  const file = session({
    turns: [
      turn({ turnId: 'old', startedAt: 0, endedAt: 1, units: 9, readings: { before: null, after: reading(1, 60, 20, WINDOW_A) } }),
      ...Array.from({ length: 12 }, (_, i) =>
        turn({ turnId: `n${i}`, startedAt: 10 + i, endedAt: 11 + i, units: i === 3 ? 2 : 0.5, readings: { before: null, after: reading(11, 2, 21, WINDOW_B) } }),
      ),
    ],
  })
  const s = sessionSummary(file, reading(100, 9, 22, WINDOW_B), RATE)
  expectNear(s.pct5h, 7.5)
  expectNear(s.pctWeek, 0.1 * (9 + 7.5))
  expect(s.count).toBe(12)
  expect(s.last).toHaveLength(10)
  expect(s.last[0]?.turnId).toBe('n11')
  expect(s.heaviest?.turnId).toBe('n3')
  expect(sessionSummary(file, null, NO_RATE).unknown).toEqual({ five_hour: true, seven_day: true })
})

test('forecasts the 5h window running out', () => {
  const now = Date.parse('2026-10-22T08:00:00.000Z')
  const resets = '2026-10-22T11:00:00.000Z'
  const readings = [reading(now - 30 * MIN, 40, 20, resets), reading(now, 60, 20, resets)]
  expect(forecast(readings, now)).toEqual({ kind: 'runsOutAt', at: now + 60 * MIN })
})

test('says the window lasts', () => {
  const now = Date.parse('2026-10-22T08:00:00.000Z')
  const resets = '2026-10-22T08:30:00.000Z'
  expect(forecast([reading(now - 30 * MIN, 40, 20, resets), reading(now, 42, 20, resets)], now)).toEqual({ kind: 'lasts' })
  expect(forecast([reading(now - 30 * MIN, 40, 20, resets), reading(now, 40, 20, resets)], now)).toEqual({ kind: 'lasts' })
})

test('does not forecast from one point of growth', () => {
  const now = Date.parse('2026-10-22T08:00:00.000Z')
  const resets = '2026-10-22T14:00:00.000Z'
  expect(forecast([reading(now - 5 * MIN, 40, 20, resets), reading(now, 41, 20, resets)], now)).toEqual({ kind: 'unknown' })
})

test('cannot forecast from one reading', () => {
  expect(forecast([reading(1, 40, 20)], 2)).toEqual({ kind: 'unknown' })
})

test('does not forecast the 5-hour window from its first minutes after a reset', () => {
  // 15:37 reset, 15:42 at 6%: five minutes of a fresh window say nothing about the next five hours.
  const now = Date.parse('2026-10-23T11:42:00.000Z')
  const resets = '2026-10-23T16:30:00.000Z'
  expect(forecast([reading(now - 5 * MIN, 1, 0, resets), reading(now, 6, 2, resets)], now)).toEqual({ kind: 'unknown' })
})

test('forecasts the week from its pace over the last day', () => {
  const now = Date.parse('2026-10-23T12:00:00.000Z')
  const readings = [reading(now - 8 * 60 * MIN, 10, 80), reading(now, 12, 96)]
  expect(weekForecast(readings, now)).toEqual({ kind: 'runsOutAt', at: now + 120 * MIN })
})

test('does not forecast the week from its first hours after a reset', () => {
  const now = Date.parse('2026-10-23T12:00:00.000Z')
  expect(weekForecast([reading(now - 5 * MIN, 1, 0), reading(now, 6, 2)], now)).toEqual({ kind: 'unknown' })
  expect(weekForecast([reading(now - 3 * 60 * MIN, 1, 0), reading(now, 30, 9)], now)).toEqual({ kind: 'unknown' })
})

test('does not forecast the week from growth older than a day', () => {
  const now = Date.parse('2026-10-23T12:00:00.000Z')
  expect(weekForecast([reading(now - 30 * 60 * MIN, 10, 80), reading(now, 12, 96)], now)).toEqual({ kind: 'unknown' })
})

test('does not forecast the week from two points of growth: readings are whole points', () => {
  const now = Date.parse('2026-10-23T12:00:00.000Z')
  expect(weekForecast([reading(now - 8 * 60 * MIN, 10, 40), reading(now, 12, 42)], now)).toEqual({ kind: 'unknown' })
})

test('lets the week last when its pace reaches the reset first', () => {
  // The week resets 2026-10-28 03:00: 15 hours away, and 57 points at 0.375 an hour take 152.
  const now = Date.parse('2026-10-27T12:00:00.000Z')
  expect(weekForecast([reading(now - 8 * 60 * MIN, 10, 40), reading(now, 12, 43)], now)).toEqual({ kind: 'lasts' })
})
