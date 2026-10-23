import { expect, test } from 'claude-code/testing'

import { NBSP, axisCells, dailyCost, heatLevel, hourlyGrid, modelBar, modelName, modelSplit, paceOf, trendGlyph } from '../hooks/lib/visuals'
import { session, turn } from './factory'
import { expectNear } from './near'

const HOUR = 3_600_000
const DAY = 24 * HOUR
// 2026-10-23 10:00 in UTC+4 (Friday).
const NOW = Date.parse('2026-10-23T06:00:00.000Z')
const TZ = 240

test('adds up cost per local day for the last 7 days, today last', () => {
  const files = [
    session({
      turns: [
        turn({ turnId: 'today', endedAt: NOW - HOUR, units: 2 }),
        turn({ turnId: 'yesterday-late', endedAt: Date.parse('2026-10-22T19:30:00.000Z'), units: 3 }),
        turn({ turnId: 'six-days-ago', endedAt: NOW - 6 * DAY, units: 1 }),
        turn({ turnId: 'too-old', endedAt: NOW - 8 * DAY, units: 9 }),
      ],
    }),
  ]
  const days = dailyCost(files, NOW, TZ)
  expect(days.map(d => d.weekday)).toEqual([6, 0, 1, 2, 3, 4, 5])
  expect(days.map(d => d.units)).toEqual([1, 0, 0, 0, 0, 3, 2])
})

test('places cost in the local hour of the day it ended', () => {
  const files = [session({ turns: [turn({ endedAt: Date.parse('2026-10-23T05:15:00.000Z'), units: 2 }), turn({ turnId: 't2', endedAt: Date.parse('2026-10-22T20:59:00.000Z'), units: 1 })] })]
  const grid = hourlyGrid(files, NOW, TZ)
  expect(grid).toHaveLength(7)
  expect(grid.every(row => row.length === 24)).toBe(true)
  expect(grid[6]?.[9]).toBe(2)
  expect(grid[6]?.[0]).toBe(1)
})

test('grades heat into four levels', () => {
  expect(heatLevel(0, 10)).toBe(0)
  expect(heatLevel(1, 10)).toBe(1)
  expect(heatLevel(5, 10)).toBe(2)
  expect(heatLevel(10, 10)).toBe(3)
  expect(heatLevel(3, 0)).toBe(0)
})

test('puts the hour labels under their columns', () => {
  const cells = axisCells()
  expect(cells).toHaveLength(24)
  expect(cells[0]).toBe('0')
  expect(cells[6]).toBe('6')
  expect(cells[12]! + cells[13]!).toBe('12')
  expect(cells[18]! + cells[19]!).toBe('18')
  expect(cells[22]! + cells[23]!).toBe('23')
  expect(cells.every(c => c.length === 1)).toBe(true)
})

test('picks a bar height for the trend', () => {
  expect(trendGlyph(0, 10)).toBe('▁')
  expect(trendGlyph(10, 10)).toBe('█')
  expect(trendGlyph(5, 10)).toBe('▅')
  expect(trendGlyph(4, 0)).toBe('▁')
})

test('never draws a busy day as idle', () => {
  expect(trendGlyph(0.1, 100)).toBe('▂')
})

test('keeps the blank axis cells non-breaking', () => {
  expect(axisCells().filter(c => c !== '0' && !/\d/.test(c)).every(c => c === NBSP)).toBe(true)
})

test('rounds the model bar to exactly its width without losing the biggest model', () => {
  expect(modelBar([{ model: 'a', units: 1, share: 1 }], 32)).toEqual([32])
  const thirds = modelBar(['a', 'b', 'c'].map(model => ({ model, units: 1, share: 1 / 3 })), 32)
  expect(thirds.reduce((s, w) => s + w, 0)).toBe(32)
  expect(Math.max(...thirds) - Math.min(...thirds) <= 1).toBe(true)
  const tiny = [{ model: 'big', units: 16, share: 0.5 }, ...Array.from({ length: 32 }, (_, i) => ({ model: `t${i}`, units: 0.5, share: 0.5 / 32 }))]
  const widths = modelBar(tiny, 32)
  expect(widths.reduce((s, w) => s + w, 0)).toBe(32)
  expect(widths[0]).toBe(16)
})

test('splits cost by model, biggest first', () => {
  const files = [
    session({
      turns: [
        turn({ model: 'claude-opus-5-5', units: 8, endedAt: 10 }),
        turn({ turnId: 't2', model: 'claude-sonnet-5-5', units: 1.5, endedAt: 20 }),
        turn({ turnId: 't3', model: 'claude-haiku-5-5', units: 0.5, endedAt: 30 }),
        turn({ turnId: 'out', model: 'claude-opus-5-5', units: 50, endedAt: 999 }),
      ],
    }),
  ]
  const split = modelSplit(files, { from: 0, to: 100 })
  expect(split.map(s => s.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
  expectNear(split[0]?.share, 0.8)
})

test('names models for people', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('claude-haiku-4-5')).toBe('Haiku 4.5')
  expect(modelName('gateway-x')).toBe('gateway-x')
  expect(modelName('claude-opus-4-20250514')).toBe('Opus 4')
  expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
})

test('measures the pace of the 5-hour window', () => {
  const resetsAt = new Date(NOW + 2 * HOUR).toISOString()
  expect(paceOf({ pct: 40, resetsAt }, NOW)).toEqual({ used: 40, elapsed: 60, verdict: 'slower' })
  expect(paceOf({ pct: 70, resetsAt }, NOW)).toEqual({ used: 70, elapsed: 60, verdict: 'faster' })
  expect(paceOf({ pct: 62, resetsAt }, NOW)).toEqual({ used: 62, elapsed: 60, verdict: 'onPace' })
})

test('has no pace for a window that already reset or an unreadable reset time', () => {
  expect(paceOf({ pct: 40, resetsAt: new Date(NOW - 1000).toISOString() }, NOW)).toBeNull()
  expect(paceOf({ pct: 40, resetsAt: 'soon' }, NOW)).toBeNull()
})
