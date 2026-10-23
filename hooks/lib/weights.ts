import type { Tokens } from '../../types'

export type Weights = { in: number; out: number; cacheRead: number; cacheWrite: number }

// US dollars per million tokens, from the claude-api skill bundled with Claude Code 2.1.304
// (prices cached 2026-10-06). Cache writes count at 1.25x input: TurnUsage does not split
// them by TTL. Only the ratios matter: the calibrated rate absorbs the scale.
const PRICES: ReadonlyArray<readonly [prefix: string, weights: Weights]> = [
  ['claude-fable-5-1', { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  ['claude-mythos-5-1', { in: 10, out: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  ['claude-fable-5', { in: 10, out: 50, cacheRead: 1, cacheWrite: 12.5 }],
  ['claude-opus-5-5', { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }],
  ['claude-opus-5', { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-opus-4', { in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 }],
  ['claude-sonnet-5', { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 }],
  ['claude-sonnet-4', { in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 }],
  ['claude-haiku-5-5', { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
  ['claude-haiku-4', { in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 }],
]

const FALLBACK: Weights = { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }

export function weightsFor(model: string): Weights {
  const id = model.replace(/^anthropic\./, '').replace(/\[[^\]]*\]$/, '')
  let best: readonly [string, Weights] | undefined
  for (const row of PRICES) {
    if (id.startsWith(row[0]) && (best === undefined || row[0].length > best[0].length)) best = row
  }
  return best?.[1] ?? FALLBACK
}

/** What a request cost in list-price dollars: the unit the percent rate is calibrated in. */
export function units(tokens: Tokens, model: string): number {
  const w = weightsFor(model)
  return (tokens.in * w.in + tokens.out * w.out + tokens.cacheRead * w.cacheRead + tokens.cacheWrite * w.cacheWrite) / 1_000_000
}
