import { expect, test } from 'claude-code/testing'

import { isParallel } from '../hooks/lib/overlap'
import { session, turn } from './factory'

const own = { startedAt: 1000, endedAt: 2000 }

test('detects an overlapping turn of another chat', () => {
  expect(isParallel(own, [session({ sessionId: 'b', turns: [turn({ startedAt: 1500, endedAt: 2500 })] })])).toBe(true)
  expect(isParallel(own, [session({ sessionId: 'b', turns: [turn({ startedAt: 500, endedAt: 1200 })] })])).toBe(true)
})

test("detects another chat's open turn", () => {
  expect(isParallel(own, [session({ sessionId: 'b', openTurn: { turnId: 'x', startedAt: 900 } })])).toBe(true)
  expect(isParallel(own, [session({ sessionId: 'b', openTurn: { turnId: 'x', startedAt: 2500 } })])).toBe(false)
})

test('ignores turns that ended before this one started', () => {
  expect(isParallel(own, [session({ sessionId: 'b', turns: [turn({ startedAt: 100, endedAt: 900 })] })])).toBe(false)
  expect(isParallel(own, [])).toBe(false)
})
