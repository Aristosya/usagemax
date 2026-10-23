import type { EngineInterface } from 'claude-code'

import type { Rate, Reading, SessionFile, TurnRecord } from '../types'
import { updateButton } from './button'
import { registerCommand } from './commands'
import { footerAfterTurn } from './footer'
import { isPanelReady, refreshPanel } from './panel'
import { hungryToast, toastsAfterTurn } from './toasts'

/**
 * Runs after a main-loop turn is saved; a returned string is shown under the answer.
 * capture.ts calls it directly: the engine lets `$` reach only functions it can follow by import.
 */
export async function afterTurn($: EngineInterface, file: SessionFile, turn: TurnRecord, answer: string, rate: Rate, others: readonly SessionFile[] = []): Promise<string | undefined> {
  await updateButton($, file, turn.readings.after, rate, others)
  if (await isPanelReady($)) await refreshPanel($)
  await toastsAfterTurn($, file, turn.readings.after)
  await hungryToast($, file, rate, turn.endedAt)
  return footerAfterTurn($, turn, answer)
}

/**
 * Runs when a main-loop turn starts. The desktop shows the button only once its state is written after
 * the footer is up, so a new chat waited for the first answer; writing here shows it as the prompt goes.
 */
export async function afterStart($: EngineInterface, file: SessionFile, before: Reading | null, rate: Rate, others: readonly SessionFile[] = []): Promise<void> {
  await updateButton($, file, before, rate, others)
}

/** Runs every minute between answers: other chats' newest readings, and a fresh time to reset. */
export async function afterTick($: EngineInterface, file: SessionFile, current: Reading | null, rate: Rate, others: readonly SessionFile[]): Promise<void> {
  await updateButton($, file, current, rate, others)
}

/** Runs when the session's file is loaded at session start. */
export async function afterLoad($: EngineInterface, file: SessionFile, rate: Rate): Promise<void> {
  await registerCommand($)
  await updateButton($, file, file.turns.at(-1)?.readings.after ?? null, rate)
}
