import type { SessionFile } from '../../types'
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

export function belongsTo(file: SessionFile, account: string, legacy: string | null): boolean {
  return file.account === undefined ? legacy === account : file.account === account
}

/** The file with only the requests that ended after a reset; the whole file without one. */
export function sinceReset(file: SessionFile, resetAt: number | null): SessionFile {
  return resetAt === null ? file : { ...file, turns: file.turns.filter(t => t.endedAt > resetAt) }
}
