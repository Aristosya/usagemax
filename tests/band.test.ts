import { expect, test } from 'claude-code/testing'

import { bandView, bandWidth } from '../hooks/button'
import type { ButtonState } from '../types'

const MIN = 60_000
const HOUR = 60 * MIN
const now = Date.parse('2026-10-23T11:50:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

/** The narrow chat from the owner's screen: 12% and 3%, both with an estimate. */
const B: ButtonState = {
  ring: 12,
  sessionPct: 1.5,
  five: { pct: 12, resetsAt: iso(now + 4 * HOUR + 35 * MIN) },
  week: { pct: 3, resetsAt: iso(now + 98 * HOUR) },
  fiveRunsOutAt: now + 2 * HOUR,
  weekRunsOutAt: now + 50 * HOUR,
  lang: 'ru',
}

test('draws everything when the band is wide', () => {
  const v = bandView(B, now, 0, 200)
  expect(v.limits.map(l => l.reset)).toEqual(['4 ч 35 мин', '4 д 2 ч'])
  expect(v.limits[0]?.estimate).toBe('▲ кончится ≈13:50')
  expect(v.limits[0]?.filled! + v.limits[0]?.empty!).toBe(8)
})

test('fits the full band into exactly its own width', () => {
  const full = bandView(B, now, 0, 0)
  expect(bandView(B, now, 0, bandWidth(full))).toEqual(full)
})

test('shortens the estimates first when the band is a little narrow', () => {
  const full = bandView(B, now, 0, 0)
  const v = bandView(B, now, 0, bandWidth(full) - 1)
  expect(v.limits[0]?.estimate).toBe('▲ ≈13:50')
  expect(v.limits[1]?.estimate).toBe('▲ ≈Вс 13:50')
  expect(v.limits.map(l => l.reset)).toEqual(['4 ч 35 мин', '4 д 2 ч'])
})

test('drops the times to reset, then the bars, never wrapping to a second row', () => {
  const noReset = bandView(B, now, 0, 70)
  expect(noReset.limits.map(l => l.reset)).toEqual([null, null])
  const tight = bandView(B, now, 0, 30)
  expect(tight.limits.map(l => l.filled + l.empty)).toEqual([0, 0])
  expect(bandWidth(tight)).toBeLessThan(bandWidth(noReset))
})

test('keeps the full band when the width is unknown', () => {
  expect(bandView(B, now, 0, 0)).toEqual(bandView(B, now, 0, 500))
})
