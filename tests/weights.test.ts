import { expect, test } from 'claude-code/testing'

import { units, weightsFor } from '../hooks/lib/weights'
import { expectNear } from './near'

test('prices Opus 5.5 tokens', () => {
  expectNear(units({ in: 1_000_000, out: 0, cacheRead: 0, cacheWrite: 0 }, 'claude-opus-5-5'), 4)
  expectNear(units({ in: 0, out: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 }, 'claude-opus-5-5'), 20.2)
})

test('picks the longest prefix and strips decorations', () => {
  expect(weightsFor('claude-fable-5-1').cacheRead).toBe(0.25)
  expect(weightsFor('claude-fable-5').cacheRead).toBe(1)
  expect(weightsFor('anthropic.claude-sonnet-5-5[1m]').in).toBe(2)
  expect(weightsFor('claude-haiku-4-5').in).toBe(1)
})

test('falls back to Opus 5.5 for an unknown model', () => {
  expect(weightsFor('some-gateway-model').in).toBe(4)
})
