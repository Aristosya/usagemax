import type { On, SessionRateLimit } from 'claude-code'
import { mock, type Engine } from 'claude-code/testing'

import type { TurnRecord } from '../types'
import { WEEK, WINDOW_A } from './factory'
import { HOME, type MemDisk, memDisk } from './memdisk'

export type Kit = {
  disk: MemDisk
  clock: ReturnType<typeof mock.clock>
  /** What `$.session.usage()` answers next: five-hour and weekly percent, or none. */
  limits: { five: number | null; week: number | null; fiveResets: string }
  sessionId: string
  /** Pane ids `$.ui.open` was called with. */
  opened: string[]
  /** Slash commands the plugin registered. */
  registered: string[]
  /** Toasts the plugin raised. */
  toasts: string[]
}

/** Everything beneath the plugin in a test: disk, env, clock, store, session facts and limit readings. */
/** `language` is Claude Code's setting; the suite reads Russian strings, so Russian unless a test says otherwise. */
export function kit(on: On, o: { sessionId?: string; now?: number; language?: string | null } = {}): Kit {
  const disk = memDisk(o.now ?? 1_000_000)
  const clock = mock.clock(on, { now: o.now ?? 1_000_000 })
  const k: Kit = { disk, clock, limits: { five: 7, week: 20, fiveResets: WINDOW_A }, sessionId: o.sessionId ?? 's1', opened: [], registered: [], toasts: [] }
  mock.store(on)
  mock.env(on, { USERPROFILE: HOME })
  const stamp = <T>(value: T) => {
    disk.now.ms = clock.now()
    return value
  }
  on('fs.read', async (_$, e) => {
    try {
      return { value: await disk.read(e.path) }
    } catch (error) {
      return { deny: String(error) }
    }
  })
  on('fs.write', async (_$, e) => stamp({ value: await disk.write(e.path, e.text) }))
  on('fs.exists', async (_$, e) => ({ value: await disk.exists(e.path) }))
  on('fs.list', async (_$, e) => {
    try {
      const entries = await disk.list(e.path)
      return { value: entries.map(x => ({ ...x, size: 0, isLink: false })) }
    } catch (error) {
      return { deny: String(error) }
    }
  })
  on('process.run', async (_$, e) => {
    const r = await disk.run(e.argv)
    return { value: { ...r, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.id', () => ({ value: k.sessionId }))
  on('session.cwd', () => ({ value: 'C:\\work' }))
  on('session.usage', () => {
    const rateLimits: SessionRateLimit[] = []
    if (k.limits.five !== null) rateLimits.push({ kind: 'five_hour', percentUsed: k.limits.five, resetsAt: k.limits.fiveResets })
    if (k.limits.week !== null) rateLimits.push({ kind: 'seven_day', percentUsed: k.limits.week, resetsAt: WEEK })
    return { value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'agent-1' }))
  on('command.register', (_$, e) => {
    k.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.open', (_$, e) => {
    k.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  const language = o.language === undefined ? 'Russian' : o.language
  const row = { key: 'language', label: 'Language', kind: 'text' as const, value: language ?? '', provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false }
  on('config.list', () => ({ value: language === null ? [] : [row] }))
  on('ui.toast', (_$, e) => {
    k.toasts.push(e.text)
    return { value: undefined }
  })
  return k
}

export const start = ($: Engine) => $.session.start({ cwd: 'C:\\work', surface: 'desktop', isInteractive: true })

export const USAGE = {
  input_tokens: 1000,
  output_tokens: 3000,
  cache_read_input_tokens: 100_000,
  cache_creation_input_tokens: 5000,
  model: 'claude-opus-5-5',
}

/** Runs one main-loop turn: start, the clock moves a minute, then completion with `usage` (or none). */
export async function runTurn(
  $: Engine,
  k: Kit,
  o: { turnId: string; text?: string; after?: { five: number | null; week: number | null }; usage?: typeof USAGE | null; reason?: 'answer' | 'aborted' },
) {
  await $.turn.start({ text: o.text ?? 'a request', turnId: o.turnId })
  await k.clock.advance(60_000)
  if (o.after) {
    k.limits.five = o.after.five
    k.limits.week = o.after.week
  }
  const usage = o.usage === undefined ? USAGE : o.usage
  return $.turn.complete({
    answer: 'Done.',
    durationMs: 60_000,
    isAborted: o.reason === 'aborted',
    turnId: o.turnId,
    reason: o.reason ?? 'answer',
    ...(usage === null ? {} : { usage }),
  })
}

/** Another chat's earlier turn that left the windows at 7% and 20%: the reading a first turn starts from. */
export async function seed(k: Kit): Promise<void> {
  const at = k.clock.now() - 100_000
  const before = { at: at - 1000, five_hour: { pct: 7, resetsAt: WINDOW_A }, seven_day: { pct: 20, resetsAt: WEEK } }
  const after = { ...before, at }
  const t = { turnId: 'seed', startedAt: at - 1000, endedAt: at, prompt: 'seed', model: 'claude-opus-5-5', tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, agents: { tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, count: 0 }, units: 0, readings: { before, after }, pct: { five_hour: { v: 0, mode: 'exact' }, seven_day: { v: 0, mode: 'exact' } }, isParallel: false, reason: 'answer' }
  await k.disk.write(`${HOME}\\.claude\\usagemax\\sessions\\seed.json`, JSON.stringify({ v: 1, sessionId: 'seed', title: 'Seed', cwd: 'C:\\seed', startedAt: 0, openTurn: null, agentTurns: {}, turns: [t] }))
}

export function savedTurns(k: Kit): TurnRecord[] {
  const file = k.disk.files.get(`${HOME}\\.claude\\usagemax\\sessions\\${k.sessionId}.json`)
  return file ? (JSON.parse(file.text) as { turns: TurnRecord[] }).turns : []
}
