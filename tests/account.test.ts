import { expect, test } from 'claude-code/testing'

import { belongsTo, loadBook, readAccount, saveBook, sinceReset, stampLegacy } from '../hooks/lib/account'
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

test("keeps each account's chats to itself", () => {
  const mine = { ...session({ sessionId: 'm' }), account: 'acc-a' }
  const theirs = { ...session({ sessionId: 't' }), account: 'acc-b' }
  const old = session({ sessionId: 'o' })
  expect([mine, theirs, old].filter(f => belongsTo(f, 'acc-a', 'acc-a')).map(f => f.sessionId)).toEqual(['m', 'o'])
  expect([mine, theirs, old].filter(f => belongsTo(f, 'acc-b', 'acc-a')).map(f => f.sessionId)).toEqual(['t'])
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
