import type { EngineInterface } from 'claude-code'

import type { SessionFile, TurnRecord } from '../types'
import { type Account, NO_ACCOUNT, accountsOf, loadBook, readAccount, saveBook, sinceReset, stampLegacy } from './lib/account'
import { diskOf } from './lib/disk'

/** Whose statistics a chat sees: its account, the account the old files belong to, and that account's last reset. */
export type Scope = { account: string; email: string | null; legacy: string | null; resetAt: number | null }

const sepOf = (path: string): string => (path.includes('\\') || !path.includes('/') ? '\\' : '/')

/**
 * The account this chat runs under. Claude Desktop names it in each chat's environment; `.claude.json`
 * answers for a terminal session and can lag days behind the desktop's account.
 */
async function accountOf($: EngineInterface): Promise<Account | null> {
  const id = await $.env.get('CLAUDE_CODE_ACCOUNT_UUID')
  if (id !== undefined && id !== '') return { id, email: (await $.env.get('CLAUDE_CODE_USER_EMAIL')) ?? null }
  const d = diskOf($)
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (await d.home())
  return readAccount(d, [configDir, '.claude.json'].join(sepOf(configDir)))
}

/** Read each time it is needed: the person may switch accounts, and a reset in the panel must reach the band. */
export async function scopeOf($: EngineInterface): Promise<Scope> {
  const d = diskOf($)
  const account = await accountOf($)
  const id = account?.id ?? NO_ACCOUNT
  const book = await loadBook(d)
  const stamped = stampLegacy(book, id)
  if (stamped !== book) await saveBook(d, stamped)
  return { account: id, email: account?.email ?? null, legacy: stamped.legacy, resetAt: stamped.resets[id] ?? null }
}

/**
 * This scope's chats with only this account's requests, every one since the reset included: what the rate
 * learns from. A chat with requests of other accounts only drops out; a chat without requests stays.
 */
export function ofScope(files: readonly SessionFile[], s: Scope): SessionFile[] {
  return cut(files, accountsOf(files, s.legacy ?? s.account, s.account), s.account)
}

/** This chat and the others cut to this scope; the others tell whose this chat's earlier requests are. */
export function splitScope(own: SessionFile, others: readonly SessionFile[], s: Scope): { own: SessionFile; others: SessionFile[] } {
  const owner = accountsOf([own, ...others], s.legacy ?? s.account, s.account)
  return { own: { ...own, turns: own.turns.filter(t => owner(t) === s.account) }, others: cut(others, owner, s.account) }
}

function cut(files: readonly SessionFile[], owner: (t: TurnRecord) => string, account: string): SessionFile[] {
  return files
    .map(f => ({ ...f, turns: f.turns.filter(t => owner(t) === account) }))
    .filter((f, i) => f.turns.length > 0 || files[i]?.turns.length === 0)
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
