import type { EngineInterface } from 'claude-code'

import type { SessionFile } from '../types'
import { NO_ACCOUNT, belongsTo, loadBook, readAccount, saveBook, sinceReset, stampLegacy } from './lib/account'
import { diskOf } from './lib/disk'

/** Whose statistics a chat sees: its account, the account the old files belong to, and that account's last reset. */
export type Scope = { account: string; email: string | null; legacy: string | null; resetAt: number | null }

const sepOf = (path: string): string => (path.includes('\\') || !path.includes('/') ? '\\' : '/')

/** Read each time it is needed: the person may switch accounts, and a reset in the panel must reach the band. */
export async function scopeOf($: EngineInterface): Promise<Scope> {
  const d = diskOf($)
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (await d.home())
  const account = await readAccount(d, [configDir, '.claude.json'].join(sepOf(configDir)))
  const id = account?.id ?? NO_ACCOUNT
  const book = await loadBook(d)
  const stamped = stampLegacy(book, id)
  if (stamped !== book) await saveBook(d, stamped)
  return { account: id, email: account?.email ?? null, legacy: stamped.legacy, resetAt: stamped.resets[id] ?? null }
}

/** This scope's chats, every request kept: what the rate learns from. */
export function ofScope(files: readonly SessionFile[], s: Scope): SessionFile[] {
  return files.filter(f => belongsTo(f, s.account, s.legacy))
}

/** This scope's chats with only the requests after its reset: what the panel, the reports and the band show. */
export function shownOf(files: readonly SessionFile[], s: Scope): SessionFile[] {
  return ofScope(files, s).map(f => sinceReset(f, s.resetAt))
}

/** Statistics of this account start over from `now`. */
export async function resetScope($: EngineInterface, now: number): Promise<void> {
  const s = await scopeOf($)
  const d = diskOf($)
  const book = await loadBook(d)
  await saveBook(d, { ...book, resets: { ...book.resets, [s.account]: now } })
}
