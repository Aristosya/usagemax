import { expect, test } from 'claude-code/testing'

import { toastsDue } from '../hooks/toasts'
import { WEEK, WINDOW_A, WINDOW_B, reading } from './factory'
import { kit, runTurn, seed, start } from './kit'

const NONE = { kind: 'unknown' } as const

test('fires 80% once per window', () => {
  expect(toastsDue([], reading(1, 81, 20), NONE)).toEqual([`5h80:${WINDOW_A}`])
  expect(toastsDue([`5h80:${WINDOW_A}`], reading(1, 85, 20), NONE)).toEqual([])
})

test('fires 80% and 90% together when the window jumps', () => {
  expect(toastsDue([], reading(1, 92, 20), NONE)).toEqual([`5h80:${WINDOW_A}`, `5h90:${WINDOW_A}`])
})

test('fires again in a new window', () => {
  expect(toastsDue([`5h80:${WINDOW_A}`], reading(1, 85, 20, WINDOW_B), NONE)).toEqual([`5h80:${WINDOW_B}`])
})

test('ignores milliseconds of the reset time', () => {
  expect(toastsDue([`5h80:${WINDOW_A}`], reading(1, 85, 20, '2026-10-22T10:40:00.433Z'), NONE)).toEqual([])
})

test('fires the weekly 80%', () => {
  expect(toastsDue([], reading(1, 10, 80), NONE)).toEqual([`wk80:${WEEK}`])
})

test('fires the run-out forecast once', () => {
  const f = { kind: 'runsOutAt', at: 5 } as const
  expect(toastsDue([], reading(1, 40, 20), f)).toEqual([`runout:${WINDOW_A}`])
  expect(toastsDue([`runout:${WINDOW_A}`], reading(1, 45, 20), f)).toEqual([])
})

test('warns once an hour when this chat ate more than 10% of the window in the last hour', async ($, on) => {
  const k = kit(on)
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'heavy', after: { five: 22, week: 20 } })
  expect(k.toasts.filter(x => x.startsWith('Чат'))).toEqual(['Чат «heavy» за час съел 15.0% окна 5 ч'])
  await runTurn($, k, { turnId: 't2', after: { five: 37, week: 20 } })
  expect(k.toasts.filter(x => x.startsWith('Чат'))).toHaveLength(1)
})

test('stays quiet under 10% of the window an hour', async ($, on) => {
  const k = kit(on)
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 16, week: 20 } })
  expect(k.toasts.some(x => x.startsWith('Чат'))).toBe(false)
})

test('raises a toast when a turn crosses 80%', async ($, on) => {
  const k = kit(on)
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 82, week: 20 } })
  expect(k.toasts).toContain('Окно 5 ч занято на 80%')
  await runTurn($, k, { turnId: 't2', after: { five: 83, week: 20 } })
  expect(k.toasts.filter(x => x === 'Окно 5 ч занято на 80%')).toHaveLength(1)
})
