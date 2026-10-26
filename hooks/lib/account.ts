import type { SessionFile, TurnRecord } from '../../types'
import type { Disk } from './disk'

/** The signed-in Claude account: Claude Code's own record of the login, read off the person's config file. */
export type Account = { id: string; email: string | null }

/**
 * `legacy`: the account the files recorded before accounts belong to, the first account seen after the
 * update. `resets`: when each account last reset its statistics.
 */
export type AccountBook = { legacy: string | null; resets: Record<string, number> }

/** Sessions without a login (an API key, a gateway) share one bucket. */
export const NO_ACCOUNT = 'default'

const sepOf = (path: string): string => (path.includes('\\') || !path.includes('/') ? '\\' : '/')

/** `oauthAccount` of `.claude.json`; null without a login. */
export async function readAccount(d: Disk, configFile: string): Promise<Account | null> {
  try {
    const config = JSON.parse(await d.read(configFile)) as { oauthAccount?: { accountUuid?: unknown; emailAddress?: unknown } }
    const id = config.oauthAccount?.accountUuid
    if (typeof id !== 'string' || id === '') return null
    const email = config.oauthAccount?.emailAddress
    return { id, email: typeof email === 'string' ? email : null }
  } catch {
    return null
  }
}

async function bookPath(d: Disk): Promise<string> {
  const home = await d.home()
  return [home, '.claude', 'usagemax', 'accounts.json'].join(sepOf(home))
}

export async function loadBook(d: Disk): Promise<AccountBook> {
  try {
    const raw = JSON.parse(await d.read(await bookPath(d))) as Partial<AccountBook>
    return { legacy: typeof raw.legacy === 'string' ? raw.legacy : null, resets: raw.resets && typeof raw.resets === 'object' ? raw.resets : {} }
  } catch {
    return { legacy: null, resets: {} }
  }
}

export async function saveBook(d: Disk, book: AccountBook): Promise<void> {
  await d.write(await bookPath(d), JSON.stringify(book))
}

/** The first account seen keeps the files recorded before accounts; later accounts start clean. */
export function stampLegacy(book: AccountBook, account: string): AccountBook {
  return book.legacy === null ? { ...book, legacy: account } : book
}

/** Reset times within a minute name one weekly window. */
const SAME_WEEK_MS = 60_000

/** When the weekly window a request saw resets; null without one. */
function weekOf(t: TurnRecord): number | null {
  const w = t.readings.after?.seven_day ?? t.readings.before?.seven_day
  return w ? Date.parse(w.resetsAt) : null
}

/**
 * Names the account of each request. A request carries its account from 0.5.8 on. An earlier one belongs to
 * the account whose marked requests saw the same weekly window, since each account counts its own week, and
 * to `legacy` when none did. A chat can move between accounts, so the chat itself names none. Until the
 * signed-in account `current` has a marked request, it claims the week of the newest reading.
 */
export function accountsOf(files: readonly SessionFile[], legacy: string, current?: string): (t: TurnRecord) => string {
  const turns = files.flatMap(f => f.turns)
  const weeks = new Map<string, number[]>()
  const claim = (account: string, w: number) => {
    const seen = weeks.get(account) ?? []
    if (!seen.some(x => Math.abs(x - w) <= SAME_WEEK_MS)) seen.push(w)
    weeks.set(account, seen)
  }
  for (const t of turns) {
    const w = weekOf(t)
    if (t.account !== undefined && w !== null) claim(t.account, w)
  }
  if (current !== undefined && !weeks.has(current)) {
    const newest = turns.reduce<TurnRecord | null>((best, t) => ((t.readings.after?.at ?? 0) > (best?.readings.after?.at ?? 0) ? t : best), null)
    const w = newest === null ? null : weekOf(newest)
    if (w !== null) claim(current, w)
  }
  return t => {
    if (t.account !== undefined) return t.account
    const w = weekOf(t)
    if (w !== null) {
      for (const [account, seen] of weeks) if (seen.some(x => Math.abs(x - w) <= SAME_WEEK_MS)) return account
    }
    return legacy
  }
}

/** The file with only the requests that ended after a reset; the whole file without one. */
export function sinceReset(file: SessionFile, resetAt: number | null): SessionFile {
  return resetAt === null ? file : { ...file, turns: file.turns.filter(t => t.endedAt > resetAt) }
}
