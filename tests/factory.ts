import type { Reading, SessionFile, Tokens, TurnRecord } from '../types'

export const WINDOW_A = '2026-10-22T10:40:00.000Z'
export const WINDOW_B = '2026-10-22T15:40:00.000Z'
export const WEEK = '2026-10-28T03:00:00.000Z'
export const DAY = 86_400_000

export const NO_TOKENS: Tokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }

export function reading(at: number, five: number | null, week: number | null, fiveResets = WINDOW_A): Reading {
  return {
    at,
    ...(five === null ? {} : { five_hour: { pct: five, resetsAt: fiveResets } }),
    ...(week === null ? {} : { seven_day: { pct: week, resetsAt: WEEK } }),
  }
}

export function turn(over: Partial<TurnRecord> = {}): TurnRecord {
  return {
    turnId: 't1',
    startedAt: 1_000,
    endedAt: 2_000,
    prompt: 'a request',
    model: 'claude-opus-5-5',
    tokens: { in: 1000, out: 3000, cacheRead: 100_000, cacheWrite: 5000 },
    agents: { tokens: NO_TOKENS, count: 0 },
    units: 1,
    readings: { before: null, after: null },
    pct: { five_hour: null, seven_day: null },
    isParallel: false,
    reason: 'answer',
    ...over,
  }
}

export function session(over: Partial<SessionFile> = {}): SessionFile {
  return {
    v: 1,
    sessionId: 's1',
    title: 'Chat one',
    cwd: 'C:\\work',
    startedAt: 0,
    openTurn: null,
    agentTurns: {},
    turns: [],
    ...over,
  }
}
