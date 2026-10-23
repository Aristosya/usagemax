import type { SessionFile } from '../../types'

/** Whether another chat had a turn running at any point of this one. */
export function isParallel(own: { startedAt: number; endedAt: number }, others: readonly SessionFile[]): boolean {
  return others.some(
    file =>
      (file.openTurn !== null && file.openTurn.startedAt < own.endedAt) ||
      file.turns.some(t => t.startedAt < own.endedAt && t.endedAt > own.startedAt),
  )
}
