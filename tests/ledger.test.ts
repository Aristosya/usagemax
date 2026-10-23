import { expect, test } from 'claude-code/testing'

import { RETENTION_MS, dataDir, loadAll, loadOwn, prune, saveOwn } from '../hooks/lib/ledger'
import { DAY, session, turn } from './factory'
import { SESSIONS, memDisk } from './memdisk'

test('starts an empty file for a new session', async () => {
  const d = memDisk()
  expect(await dataDir(d)).toBe(SESSIONS)
  const own = await loadOwn(d, 's1', 'C:\\work', 5)
  expect(own).toEqual(session({ sessionId: 's1', title: '', cwd: 'C:\\work', startedAt: 5 }))
})

test('keeps a copy of a broken own file', async () => {
  const d = memDisk()
  d.files.set(`${SESSIONS}\\s1.json`, { text: '{"v":1,"sessionId":"s1","tu', mtimeMs: 1 })
  const own = await loadOwn(d, 's1', 'C:\\work', 5)
  expect(own.turns).toHaveLength(0)
  expect(d.files.get(`${SESSIONS}\\s1.json.bak`)?.text).toBe('{"v":1,"sessionId":"s1","tu')
})

test('saves and loads its own file', async () => {
  const d = memDisk()
  await saveOwn(d, session({ turns: [turn()] }))
  expect(d.files.has(`${SESSIONS}\\s1.json`)).toBe(true)
  expect((await loadOwn(d, 's1', 'C:\\work', 5)).turns).toHaveLength(1)
})

test('rolls old turns over past 2 MiB', async () => {
  const d = memDisk()
  const turns = Array.from({ length: 5000 }, (_, i) => turn({ turnId: `t${i}`, startedAt: 1000 + i, endedAt: 1000 + i, prompt: 'x'.repeat(120) }))
  const own = session({ turns })
  await saveOwn(d, own)
  expect(own.turns).toHaveLength(200)
  expect(d.files.has(`${SESSIONS}\\s1.1.json`)).toBe(true)
  expect(JSON.parse(d.files.get(`${SESSIONS}\\s1.json`)?.text ?? '{}').turns).toHaveLength(200)
  const all = await loadAll(d, { since: 0 })
  expect(all).toHaveLength(1)
  expect(all[0]?.turns).toHaveLength(5000)
  expect(all[0]?.turns[0]?.turnId).toBe('t0')
})

test('skips a file that is not valid JSON', async () => {
  const d = memDisk()
  await saveOwn(d, session({ sessionId: 's1' }))
  await saveOwn(d, session({ sessionId: 's3' }))
  d.files.set(`${SESSIONS}\\s2.json`, { text: '{"v":1,"sess', mtimeMs: d.now.ms })
  const all = await loadAll(d, { since: 0 })
  expect(all.map(f => f.sessionId).sort()).toEqual(['s1', 's3'])
})

test('does not open files older than the period', async () => {
  const d = memDisk(1000)
  await saveOwn(d, session({ sessionId: 'old' }))
  d.now.ms = 50_000
  await saveOwn(d, session({ sessionId: 'new' }))
  const all = await loadAll(d, { since: 10_000 })
  expect(all.map(f => f.sessionId)).toEqual(['new'])
  expect(d.reads.some(p => p.endsWith('old.json'))).toBe(false)
})

test('leaves out the excluded session', async () => {
  const d = memDisk()
  await saveOwn(d, session({ sessionId: 'me' }))
  await saveOwn(d, session({ sessionId: 'other' }))
  expect((await loadAll(d, { since: 0, exclude: 'me' })).map(f => f.sessionId)).toEqual(['other'])
})

test('reads nothing when no file was written yet', async () => {
  expect(await loadAll(memDisk(), { since: 0 })).toEqual([])
})

test('prunes turns and files older than 30 days', async () => {
  const now = 40 * DAY
  const d = memDisk(now - 31 * DAY)
  await saveOwn(d, session({ sessionId: 'gone' }))
  d.now.ms = now
  const own = session({ turns: [turn({ turnId: 'old', endedAt: now - 31 * DAY }), turn({ turnId: 'new', endedAt: now - DAY })] })
  await saveOwn(d, own)
  const kept = await prune(d, own, now)
  expect(kept.turns.map(t => t.turnId)).toEqual(['new'])
  expect(d.files.has(`${SESSIONS}\\gone.json`)).toBe(false)
  expect(d.commands[0]).toEqual(['cmd', '/c', 'del', '/q', `${SESSIONS}\\gone.json`])
  expect(d.files.has(`${SESSIONS}\\s1.json`)).toBe(true)
  expect(RETENTION_MS).toBe(30 * DAY)
})
