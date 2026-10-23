import type { SessionFile, TurnRecord } from '../../types'
import type { Disk, DiskEntry } from './disk'

export const RETENTION_MS = 30 * 86_400_000
export const ROLLOVER_BYTES = 2 * 1024 * 1024
/** Turns a session keeps in its main file after a rollover. */
const KEEP_AFTER_ROLLOVER = 200

const PART = /^(.+?)(?:\.(\d+))?\.json$/

function join(dir: string, name: string): string {
  return `${dir}${dir.includes('\\') ? '\\' : '/'}${name}`
}

export async function dataDir(d: Disk): Promise<string> {
  const home = await d.home()
  const sep = home.includes('\\') || !home.includes('/') ? '\\' : '/'
  return [home, '.claude', 'usagemax', 'sessions'].join(sep)
}

export function emptySession(sessionId: string, cwd: string, now: number): SessionFile {
  return { v: 1, sessionId, title: '', cwd, startedAt: now, openTurn: null, agentTurns: {}, turns: [] }
}

function parse(text: string): SessionFile | null {
  try {
    const file = JSON.parse(text) as Partial<SessionFile>
    return file.v === 1 && typeof file.sessionId === 'string' && Array.isArray(file.turns) ? (file as SessionFile) : null
  } catch {
    return null
  }
}

/** This session's own file; a missing one starts empty, a broken one is copied to `.json.bak` first. */
export async function loadOwn(d: Disk, sessionId: string, cwd: string, now: number): Promise<SessionFile> {
  const path = join(await dataDir(d), `${sessionId}.json`)
  let text: string
  try {
    text = await d.read(path)
  } catch {
    return emptySession(sessionId, cwd, now)
  }
  const file = parse(text)
  if (file && file.sessionId === sessionId) return file
  if (text.trim() !== '') await d.write(`${path}.bak`, text)
  return emptySession(sessionId, cwd, now)
}

/**
 * Writes this session's file. Past ROLLOVER_BYTES every turn but the last 200 moves to
 * `<sessionId>.<n>.json`, and `file.turns` keeps only those 200.
 */
export async function saveOwn(d: Disk, file: SessionFile): Promise<void> {
  const dir = await dataDir(d)
  let text = JSON.stringify(file)
  if (new TextEncoder().encode(text).length > ROLLOVER_BYTES && file.turns.length > KEEP_AFTER_ROLLOVER) {
    const old = file.turns.slice(0, -KEEP_AFTER_ROLLOVER)
    let n = 1
    while (await d.exists(join(dir, `${file.sessionId}.${n}.json`))) n += 1
    await d.write(join(dir, `${file.sessionId}.${n}.json`), JSON.stringify({ ...file, openTurn: null, turns: old }))
    file.turns = file.turns.slice(-KEEP_AFTER_ROLLOVER)
    text = JSON.stringify(file)
  }
  await d.write(join(dir, `${file.sessionId}.json`), text)
}

/** Every session file changed since `since`, parts of one session merged; unreadable files are skipped. */
export async function loadAll(d: Disk, o: { since: number; exclude?: string }): Promise<SessionFile[]> {
  const dir = await dataDir(d)
  let entries: readonly DiskEntry[]
  try {
    entries = await d.list(dir)
  } catch {
    return []
  }
  const heads = new Map<string, SessionFile>()
  const parts = new Map<string, TurnRecord[]>()
  for (const entry of entries) {
    const match = PART.exec(entry.name)
    if (entry.kind !== 'file' || !match?.[1] || match[1] === o.exclude || entry.mtimeMs < o.since) continue
    let file: SessionFile | null
    try {
      file = parse(await d.read(join(dir, entry.name)))
    } catch {
      file = null
    }
    if (!file) continue
    if (match[2] === undefined) heads.set(file.sessionId, file)
    parts.set(file.sessionId, [...(parts.get(file.sessionId) ?? []), ...file.turns])
  }
  const out: SessionFile[] = []
  for (const [id, turns] of parts) {
    const head = heads.get(id)
    if (!head) continue
    out.push({ ...head, turns: [...turns].sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt) })
  }
  return out
}

/** Drops this session's turns older than 30 days and deletes other files untouched for 30 days. */
export async function prune(d: Disk, own: SessionFile, now: number): Promise<SessionFile> {
  const cutoff = now - RETENTION_MS
  const dir = await dataDir(d)
  let entries: readonly DiskEntry[] = []
  try {
    entries = await d.list(dir)
  } catch {
    // Nothing written yet.
  }
  for (const entry of entries) {
    if (entry.kind !== 'file' || !PART.test(entry.name) || entry.mtimeMs >= cutoff) continue
    const path = join(dir, entry.name)
    try {
      const run = await d.run(['cmd', '/c', 'del', '/q', path])
      if (run.exitCode === 0 && !(await d.exists(path))) continue
    } catch {
      // Fall through to blanking the file.
    }
    await d.write(path, JSON.stringify({ ...emptySession(PART.exec(entry.name)?.[1] ?? '', '', 0) }))
  }
  return { ...own, turns: own.turns.filter(t => t.endedAt >= cutoff) }
}
