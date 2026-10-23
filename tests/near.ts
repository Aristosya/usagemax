import { expect } from 'claude-code/testing'

/** The kit has no toBeCloseTo: a float matches when it is within 1e-6 of the expected value. */
export function expectNear(actual: number | null | undefined, expected: number): void {
  expect(typeof actual).toBe('number')
  expect(Math.abs((actual ?? Number.NaN) - expected) < 1e-6).toBe(true)
}
