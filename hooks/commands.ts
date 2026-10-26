import type { EngineInterface, On } from 'claude-code'

import type { Period, TopRow, TurnRecord } from '../types'
import { diskOf } from './lib/disk'
import { type Lang, langOf, t } from './lib/i18n'
import { sinceReset } from './lib/account'
import { loadAll, loadOwn } from './lib/ledger'
import { PERIOD_KEY, computePanel, openPanel, requestLine, rowLines } from './panel'
import { scopeOf, splitScope } from './scope'

/** Chats read to tell whose this chat's earlier requests are. */
const HISTORY_MS = 7 * 86_400_000

const ARG_PERIOD: Readonly<Record<string, Period>> = { hour: 'hour', today: 'today', yesterday: 'yesterday', '5h': 'window5h', week: 'week' }

/** The full top of a period as plain text, one chat per line with its heaviest request under it. */
export function reportText(rows: readonly TopRow[], p: Period, lang: Lang): string {
  const lines = [t(lang, 'report.top', { period: t(lang, PERIOD_KEY[p]) })]
  if (rows.length === 0) lines.push(t(lang, 'report.none'))
  rows.forEach((r, i) => {
    const [line, heavy] = rowLines(r, i, p, lang)
    lines.push(line)
    if (heavy !== null) lines.push(heavy)
  })
  return lines.join('\n')
}

export function chatText(turns: readonly TurnRecord[], lang: Lang, tz: number): string {
  const lines = [t(lang, 'report.chat')]
  if (turns.length === 0) lines.push(t(lang, 'report.none'))
  for (const x of turns) lines.push(requestLine(x, tz, lang))
  return lines.join('\n')
}

async function topReport($: EngineInterface, p: Period): Promise<string> {
  const data = await computePanel($)
  return reportText(data.top[p], p, data.lang)
}

async function chatReport($: EngineInterface): Promise<string> {
  const now = await $.clock.now()
  const d = diskOf($)
  const file = await loadOwn(d, await $.session.id(), await $.session.cwd(), now)
  const scope = await scopeOf($)
  const own = sinceReset(splitScope(file, await loadAll(d, { since: now - HISTORY_MS, exclude: file.sessionId }), scope).own, scope.resetAt)
  return chatText(own.turns, await langOf($), -new Date(now).getTimezoneOffset())
}

/** Called from afterLoad at session start: one `session.start` hook per plugin is allowed. */
export async function registerCommand($: EngineInterface): Promise<void> {
  await $.command.register({ name: 'usagemax', description: t(await langOf($), 'cmd.description') })
}

/** `/usagemax`: the panel; `top [hour|today|5h|week]`, `chat` and `hour` print reports without calling the model. */
export function commands(on: On): void {
  on('command.run', { command: 'usagemax' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    if (verb === '') {
      await openPanel($)
      return { text: '' }
    }
    if (verb === 'top') {
      const p = arg === '' ? 'today' : ARG_PERIOD[arg]
      if (p !== undefined) return { text: await topReport($, p) }
    }
    if (verb === 'hour') return { text: await topReport($, 'hour') }
    if (verb === 'chat') return { text: await chatReport($) }
    return { text: t(await langOf($), 'cmd.help') }
  })
}
