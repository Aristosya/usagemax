import { expect, test } from 'claude-code/testing'

import { calibrate, sameWindow, turnPercent } from '../hooks/lib/percent'
import { DAY, WINDOW_A, WINDOW_B, reading, turn } from './factory'
import { expectNear } from './near'

const NO_RATE = { five_hour: null, seven_day: null }

test('treats resetsAt within 60 s as one window', () => {
  expect(sameWindow({ pct: 1, resetsAt: '2026-10-28T03:00:00.433Z' }, { pct: 1, resetsAt: '2026-10-28T03:00:00.000Z' })).toBe(true)
  expect(sameWindow({ pct: 1, resetsAt: '2026-10-28T03:00:00.000Z' }, { pct: 1, resetsAt: '2026-10-28T04:00:00.000Z' })).toBe(false)
})

test('uses the exact delta when the chat ran alone and the delta is ten steps or more', () => {
  const p = turnPercent({ before: reading(0, 7, 20), after: reading(1, 18, 21), units: 5, isParallel: false, rate: NO_RATE, step: 1 })
  expect(p.five_hour).toEqual({ v: 11, mode: 'exact' })
  const fine = turnPercent({ before: reading(0, 7.0, 20), after: reading(1, 8.2, 20), units: 1, isParallel: false, rate: NO_RATE, step: 0.1 })
  expectNear(fine.five_hour?.v, 1.2)
  expect(fine.five_hour?.mode).toBe('exact')
})

test('estimates a small delta from the rate', () => {
  const p = turnPercent({ before: reading(0, 7, 28), after: reading(1, 8, 29), units: 0.5, isParallel: false, rate: { five_hour: 0.6, seven_day: 0.02 }, step: 1 })
  expectNear(p.five_hour?.v, 0.3)
  expect(p.five_hour?.mode).toBe('estimate')
  expectNear(p.seven_day?.v, 0.01)
  expect(p.seven_day?.mode).toBe('estimate')
})

test('estimates a parallel turn even when the delta is large', () => {
  const p = turnPercent({ before: reading(0, 7, 20), after: reading(1, 20, 20), units: 1, isParallel: true, rate: { five_hour: 0.6, seven_day: null }, step: 1 })
  expectNear(p.five_hour?.v, 0.6)
  expect(p.five_hour?.mode).toBe('estimate')
})

test('hides a small integer delta before calibration', () => {
  const p = turnPercent({ before: reading(0, 8, 28), after: reading(1, 9, 29), units: 0.7, isParallel: false, rate: NO_RATE, step: 1 })
  expect(p.five_hour).toBeNull()
  expect(p.seven_day).toBeNull()
})

test('falls back to a large raw delta before calibration', () => {
  const p = turnPercent({ before: reading(0, 7, 20), after: reading(1, 19, 20), units: 1, isParallel: true, rate: NO_RATE, step: 1 })
  expect(p.five_hour).toEqual({ v: 12, mode: 'raw' })
})

test('never gives the first turn the whole window', () => {
  expect(turnPercent({ before: null, after: reading(1, 40, 20), units: 0.5, isParallel: false, rate: NO_RATE, step: 1 }).five_hour).toBeNull()
  const p = turnPercent({ before: null, after: reading(1, 40, 20), units: 0.5, isParallel: false, rate: { five_hour: 0.6, seven_day: null }, step: 1 })
  expectNear(p.five_hour?.v, 0.3)
  expect(p.five_hour?.mode).toBe('estimate')
})

test('counts a reset window from zero', () => {
  const p = turnPercent({ before: reading(0, 95, 20, WINDOW_A), after: reading(1, 12, 20, WINDOW_B), units: 1, isParallel: false, rate: NO_RATE, step: 1 })
  expect(p.five_hour).toEqual({ v: 12, mode: 'raw' })
})

test('leaves out a window the account does not have', () => {
  const p = turnPercent({ before: reading(0, 7, null), after: reading(1, 18, null), units: 1, isParallel: false, rate: NO_RATE, step: 1 })
  expect(p.seven_day).toBeNull()
})

/** A turn of any chat that ended at `at`, cost `units`, and left the windows at `five` / `week`. */
const ended = (id: string, at: number, units: number, five: number, week: number, before: number | null = null, resets = WINDOW_A) =>
  turn({ turnId: id, startedAt: at - 500, endedAt: at, units, readings: { before: before === null ? null : reading(at - 500, before, week, resets), after: reading(at, five, week, resets) } })

test("calibrates on the account's growth over every request, parallel ones included", () => {
  const now = 10 * DAY
  const turns = [
    ended('a1', now - 5000, 1, 10, 20),
    ended('b1', now - 4000, 1, 12, 21),
    ended('a2', now - 3000, 2, 14, 22, 3),
    ended('c1', now - 2000, 1, 15, 23),
  ]
  const rate = calibrate(turns, now)
  expectNear(rate.five_hour, 5 / 4)
  expectNear(rate.seven_day, 3 / 4)
})

test('shares add up to the real growth whatever the readings before each request say', () => {
  const now = 10 * DAY
  const turns = [ended('a1', now - 5000, 1, 30, 40), ended('a2', now - 4000, 3, 31, 41, 1), ended('b1', now - 3000, 1, 36, 43, 2)]
  const rate = calibrate(turns, now)
  const total = turns.slice(1).reduce((sum, t) => sum + t.units * (rate.five_hour ?? 0), 0)
  expectNear(total, 6)
})

test('counts a reset window from its new value', () => {
  const now = 10 * DAY
  const turns = [ended('a1', now - 5000, 1, 95, 20, null, WINDOW_A), ended('a2', now - 4000, 2, 6, 23, null, WINDOW_B)]
  expectNear(calibrate(turns, now).five_hour, 6 / 2)
})

test('waits for 5 points of the 5-hour window and 3 of the week', () => {
  const now = 10 * DAY
  const turns = [ended('a1', now - 5000, 1, 10, 20), ended('a2', now - 4000, 1, 14, 22)]
  expect(calibrate(turns, now)).toEqual({ five_hour: null, seven_day: null })
})

test('leaves out requests older than 7 days', () => {
  const now = 10 * DAY
  const turns = [ended('old', now - 8 * DAY, 100, 0, 0), ended('a1', now - 5000, 1, 10, 20), ended('a2', now - 4000, 2, 20, 26)]
  expectNear(calibrate(turns, now).five_hour, 10 / 2)
})
