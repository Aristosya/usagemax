import type { EngineInterface, On, TurnUsage } from 'claude-code'

import type { Rate, Reading, SessionFile, Tokens, TurnRecord } from '../types'
import { afterLoad, afterStart, afterTick, afterTurn } from './after'
import { diskOf } from './lib/disk'
import { loadAll, loadOwn, prune, saveOwn } from './lib/ledger'
import { isParallel } from './lib/overlap'
import { calibrate, turnPercent } from './lib/percent'
import { readingFrom } from './lib/readings'
import { resolveTitle } from './lib/title'
import { units } from './lib/weights'
import { checkForUpdate } from './update'
import { type Scope, ofScope, scopeOf } from './scope'
import { sinceReset } from './lib/account'

/** Limit readings move in whole points on Claude Code 2.1.304. */
const STEP = 1
const HISTORY_MS = 7 * 86_400_000
/** How far back other chats' files are read for parallel turns and fresh readings: longer than any turn. */
const LOOKBACK_MS = 6 * 3_600_000
/** Other chats' turns are re-read for the rate every this many turns. */
const REFRESH_EVERY = 20
/** The chat's name is re-read on the first turn and every this many after it. */
const TITLE_EVERY = 10
const ZERO: Tokens = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
/** How often the band re-reads every chat's newest reading and counts the time to reset down. */
const BAND_REFRESH_MS = 60_000
const UPDATE_DELAY_MS = 5_000

type Pending = { startedAt: number; prompt: string; before: Reading | null; agentTokens: Tokens; agentUnits: number; agentCount: number }

const pending = new Map<string, Pending>()
let own: SessionFile | null = null
let history: TurnRecord[] = []
let rate: Rate = { five_hour: null, seven_day: null }
let current: string | null = null
let ticker: { cancel: () => void } | null = null
/** Whose statistics this chat sees; read again at each start, turn and tick. */
let scope: Scope = { account: 'default', email: null, legacy: null, resetAt: null }

/** This session's file as last saved, or null before the session started. */
export function currentSession(): SessionFile | null {
  return own
}

export function currentRate(): Rate {
  return rate
}

/**
 * The request as the reports show it: one line, first 120 characters. A turn the engine started with a
 * message of its own (`<task-notification>`, `<cross-session-message>`) shows that message's text.
 */
export function promptSnippet(text: string): string {
  let body = text
  if (/^\s*<[a-z][\w-]*[\s>]/i.test(text)) {
    const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]
    body = summary ?? text.replace(/<\/?[a-z][\w-]*(?:\s[^>]*)?>/gi, ' ')
  }
  return body.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function tokensOf(u: TurnUsage): Tokens {
  return { in: u.input_tokens, out: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens }
}

function addTokens(a: Tokens, b: Tokens): Tokens {
  return { in: a.in + b.in, out: a.out + b.out, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }
}

async function loadHistory($: EngineInterface, sessionId: string, now: number): Promise<TurnRecord[]> {
  return ofScope(await loadAll(diskOf($), { since: now - HISTORY_MS, exclude: sessionId }), scope).flatMap(f => f.turns)
}

/** Other chats of this account; another account's limits are not this one's. */
async function othersOf($: EngineInterface, since: number, exclude: string): Promise<SessionFile[]> {
  return ofScope(await loadAll(diskOf($), { since, exclude }), scope)
}

/** This chat as the band and the toasts show it: its requests since the account's last reset. */
const shown = (file: SessionFile): SessionFile => sinceReset(file, scope.resetAt)

/**
 * The newest limit reading any chat recorded by `now`, with the time it was taken. `$.session.usage()`
 * would answer this chat's last response, stale whenever another chat ran in between.
 */
function freshestReading(files: readonly SessionFile[], now: number): Reading | null {
  let best: Reading | null = null
  for (const t of files.flatMap(f => f.turns)) {
    const r = t.readings.after
    if (r && r.at <= now && (best === null || r.at > best.at)) best = r
  }
  return best
}

/** The band between this chat's answers: every chat's newest reading, and the time to reset from now. */
export async function refreshBand($: EngineInterface): Promise<void> {
  if (!own) return
  const now = await $.clock.now()
  scope = await scopeOf($)
  const others = await othersOf($, now - LOOKBACK_MS, own.sessionId)
  await afterTick($, shown(own), freshestReading([own, ...others], now), rate, others)
}

async function load($: EngineInterface): Promise<SessionFile> {
  const now = await $.clock.now()
  const sessionId = await $.session.id()
  scope = await scopeOf($)
  const file = await prune(diskOf($), await loadOwn(diskOf($), sessionId, await $.session.cwd(), now), now)
  file.openTurn = null
  file.account = scope.account
  file.title = await resolveTitle(diskOf($), file.cwd, file.sessionId, file.turns[0]?.prompt ?? file.title)
  history = await loadHistory($, sessionId, now)
  rate = calibrate([...history, ...file.turns], now)
  await $.store.set('rate', rate)
  await saveOwn(diskOf($), file)
  own = file
  await afterLoad($, shown(file), rate)
  return file
}

async function addAgent($: EngineInterface, file: SessionFile, agentId: string, usage: TurnUsage | undefined): Promise<void> {
  const turnId = file.agentTurns[agentId]
  if (!usage || turnId === undefined) return
  const tokens = tokensOf(usage)
  const cost = units(tokens, usage.model)
  const open = pending.get(turnId)
  if (open) {
    open.agentTokens = addTokens(open.agentTokens, tokens)
    open.agentUnits += cost
    open.agentCount += 1
    return
  }
  const t = file.turns.find(x => x.turnId === turnId)
  if (!t) return
  t.agents = { tokens: addTokens(t.agents.tokens, tokens), count: t.agents.count + 1 }
  t.units += cost
  t.pct = turnPercent({ before: t.readings.before, after: t.readings.after, units: t.units, isParallel: t.isParallel, rate, step: STEP })
  await saveOwn(diskOf($), file)
}

/** Records every main-loop request: limit readings around it, tokens, cost units and its percent. */
export function capture(on: On): void {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    pending.clear()
    current = null
    await load($)
    // Limits arrive only with answers; between them another chat's answer is the one news there is.
    ticker?.cancel()
    ticker = $.clock.every(BAND_REFRESH_MS, () => {
      refreshBand($).catch(() => undefined)
    })
    // A few seconds in, off the start's path: a git fetch must not hold the first prompt.
    $.clock.after(UPDATE_DELAY_MS, () => {
      checkForUpdate($).catch(() => undefined)
    })
    return r
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // `session.start` does not fire on /clear: a new session id means a new file.
    const file = own !== null && own.sessionId === (await $.session.id()) ? own : await load($)
    const now = await $.clock.now()
    scope = await scopeOf($)
    const others = await othersOf($, now - LOOKBACK_MS, file.sessionId)
    const before = freshestReading([file, ...others], now)
    pending.set(e.turnId, { startedAt: now, prompt: promptSnippet(e.text), before, agentTokens: ZERO, agentUnits: 0, agentCount: 0 })
    current = e.turnId
    file.openTurn = { turnId: e.turnId, startedAt: now }
    await saveOwn(diskOf($), file)
    await afterStart($, shown(file), before, rate, others)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId !== undefined && current !== null && own) {
      own.agentTurns[r.agentId] = current
      await saveOwn(diskOf($), own)
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const file = own ?? (await load($))
    if (e.agentId !== undefined) {
      await addAgent($, file, e.agentId, e.usage)
      return r
    }
    const p = pending.get(e.turnId)
    pending.delete(e.turnId)
    if (current === e.turnId) current = null
    file.openTurn = null
    if (!e.usage || !p) {
      await saveOwn(diskOf($), file)
      return r
    }
    const now = await $.clock.now()
    const after = readingFrom(await $.session.usage(), now)
    const cost = units(tokensOf(e.usage), e.usage.model) + p.agentUnits
    scope = await scopeOf($)
    const others = await othersOf($, p.startedAt - LOOKBACK_MS, file.sessionId)
    const parallel = isParallel({ startedAt: p.startedAt, endedAt: now }, others)
    const record: TurnRecord = {
      turnId: e.turnId,
      startedAt: p.startedAt,
      endedAt: now,
      prompt: p.prompt,
      model: e.usage.model,
      tokens: tokensOf(e.usage),
      agents: { tokens: p.agentTokens, count: p.agentCount },
      units: cost,
      readings: { before: p.before, after },
      pct: turnPercent({ before: p.before, after, units: cost, isParallel: parallel, rate, step: STEP }),
      isParallel: parallel,
      reason: e.reason,
    }
    file.turns.push(record)
    if (file.title === '' || file.turns.length % TITLE_EVERY === 1) {
      file.title = await resolveTitle(diskOf($), file.cwd, file.sessionId, file.turns[0]?.prompt ?? '')
    }
    if (file.turns.length % REFRESH_EVERY === 0) history = await loadHistory($, file.sessionId, now)
    rate = calibrate([...history, ...file.turns], now)
    await $.store.set('rate', rate)
    await saveOwn(diskOf($), file)
    const text = await afterTurn($, shown(file), record, e.answer, rate, others)
    return text === undefined ? r : { ...r, text }
  })
}
