import { expect, test } from 'claude-code/testing'

import { accountsOf, loadBook, readAccount, saveBook, sinceReset, stampLegacy } from '../hooks/lib/account'
import { session, turn } from './factory'
import { HOME, memDisk } from './memdisk'

const CONFIG = `${HOME}\\.claude.json`

test("reads the signed-in account from Claude Code's config", async () => {
  const d = memDisk()
  await d.write(CONFIG, JSON.stringify({ oauthAccount: { accountUuid: 'acc-a', emailAddress: 'a@example.com' }, other: 1 }))
  expect(await readAccount(d, CONFIG)).toEqual({ id: 'acc-a', email: 'a@example.com' })
})

test('has no account without a login in the config', async () => {
  const d = memDisk()
  expect(await readAccount(d, CONFIG)).toBeNull()
  await d.write(CONFIG, JSON.stringify({ oauthAccount: {} }))
  expect(await readAccount(d, CONFIG)).toBeNull()
})

test('gives the files recorded before accounts to the first account seen, once', () => {
  const book = stampLegacy({ legacy: null, resets: {} }, 'acc-a')
  expect(book.legacy).toBe('acc-a')
  expect(stampLegacy(book, 'acc-b').legacy).toBe('acc-a')
})

test('names the account of each request: its mark, else the account that saw the same week, else the legacy one', () => {
  const OLD = '2026-10-28T03:00:00.000Z'
  const NEW = '2026-10-27T14:00:00.000Z'
  const saw = (id: string, resetsAt: string, account?: string) =>
    turn({ turnId: id, ...(account === undefined ? {} : { account }), readings: { before: null, after: { at: 1, seven_day: { pct: 1, resetsAt } } } })
  // One chat that moved from acc-a to acc-b: the requests before the marks follow the week they saw.
  const moved = session({ sessionId: 'm', turns: [saw('old-a', OLD), saw('old-b', NEW), saw('new-b', NEW, 'acc-b'), turn({ turnId: 'blind' })] })
  const owner = accountsOf([moved], 'acc-a')
  expect(moved.turns.map(owner)).toEqual(['acc-a', 'acc-b', 'acc-b', 'acc-a'])
})

test('before its first marked request, the signed-in account claims the week of the newest reading', () => {
  const saw = (id: string, at: number, resetsAt: string) => turn({ turnId: id, endedAt: at, readings: { before: null, after: { at, seven_day: { pct: 1, resetsAt } } } })
  const file = session({ turns: [saw('old', 1, '2026-10-28T03:00:00.000Z'), saw('newest', 2, '2026-10-27T14:00:00.000Z')] })
  expect(file.turns.map(accountsOf([file], 'acc-a', 'acc-b'))).toEqual(['acc-a', 'acc-b'])
})

test('shows only the requests after a reset', () => {
  const file = session({ sessionId: 's', turns: [turn({ turnId: 'before', endedAt: 100 }), turn({ turnId: 'after', endedAt: 300 })] })
  expect(sinceReset(file, 200).turns.map(t => t.turnId)).toEqual(['after'])
  expect(sinceReset(file, null).turns).toHaveLength(2)
  // A request that ended at the reset's own instant belongs to the statistics that were reset.
  expect(sinceReset(file, 300).turns).toHaveLength(0)
})

test('keeps the book of accounts and resets on disk', async () => {
  const d = memDisk()
  expect(await loadBook(d)).toEqual({ legacy: null, resets: {} })
  await saveBook(d, { legacy: 'acc-a', resets: { 'acc-a': 500 } })
  expect(await loadBook(d)).toEqual({ legacy: 'acc-a', resets: { 'acc-a': 500 } })
  expect(d.files.has(`${HOME}\\.claude\\usagemax\\accounts.json`)).toBe(true)
})
