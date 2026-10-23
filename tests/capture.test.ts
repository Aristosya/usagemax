import { expect, test } from 'claude-code/testing'

import { promptSnippet } from '../hooks/capture'
import { reading, session, turn } from './factory'
import { kit, runTurn, savedTurns, seed, start } from './kit'
import { SESSIONS } from './memdisk'

test('records a turn with readings, tokens and percent', async ($, on) => {
  const k = kit(on)
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'x'.repeat(300), after: { five: 18, week: 20 } })
  const [t] = savedTurns(k)
  expect(t?.pct.five_hour).toEqual({ v: 11, mode: 'exact' })
  expect(t?.pct.seven_day).toBeNull()
  expect(t?.prompt).toHaveLength(120)
  expect(t?.tokens).toEqual({ in: 1000, out: 3000, cacheRead: 100_000, cacheWrite: 5000 })
  expect(t?.readings.before?.five_hour?.pct).toBe(7)
  expect(t?.readings.after?.five_hour?.pct).toBe(18)
  expect(t?.isParallel).toBe(false)
})

test('keeps the prompt on one line', () => {
  expect(promptSnippet('a\n\n  b\tc ')).toBe('a b c')
})

test('names a background task notification by its summary', () => {
  const text = '<task-notification>\n<task-id>bwez</task-id>\n<status>completed</status>\n<summary>Agent "Final review" finished</summary>\n</task-notification>'
  expect(promptSnippet(text)).toBe('Agent "Final review" finished')
})

test('shows the text of a message from another session', () => {
  expect(promptSnippet('<cross-session-message from="uds:pipe" from-session="local_26a3">\nПроверь PR 670\n</cross-session-message>')).toBe('Проверь PR 670')
})

test('keeps tags inside a typed request', () => {
  expect(promptSnippet('fix the <Button> label')).toBe('fix the <Button> label')
})

test('writes nothing for a turn that never reached the model', async ($, on) => {
  const k = kit(on)
  await start($)
  await runTurn($, k, { turnId: 't1', usage: null, reason: 'aborted' })
  expect(savedTurns(k)).toHaveLength(0)
})

test('records an interrupted turn that already spent tokens', async ($, on) => {
  const k = kit(on)
  await start($)
  await runTurn($, k, { turnId: 't1', reason: 'aborted' })
  expect(savedTurns(k)[0]?.reason).toBe('aborted')
})

test('adds a background agent to the turn that started it', async ($, on) => {
  const k = kit(on)
  await start($)
  await $.turn.start({ text: 'spawn one', turnId: 't1' })
  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'wait',
    description: 'wait',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })
  await $.turn.complete({ answer: 'Started.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-opus-5-5' } })
  const unitsBefore = savedTurns(k)[0]?.units ?? 0
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'a-turn', agentId: 'agent-1', reason: 'answer', usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 72_069, model: 'claude-haiku-5-5' } })
  const t = savedTurns(k)[0]
  expect(t?.agents.count).toBe(1)
  expect(t?.agents.tokens.cacheWrite).toBe(72_069)
  expect((t?.units ?? 0) > unitsBefore).toBe(true)
})

test('marks a turn parallel when another chat had an open turn', async ($, on) => {
  const k = kit(on)
  await k.disk.write(`${SESSIONS}\\other.json`, JSON.stringify(session({ sessionId: 'other', openTurn: { turnId: 'x', startedAt: 0 } })))
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 30, week: 20 } })
  const t = savedTurns(k)[0]
  expect(t?.isParallel).toBe(true)
  expect(t?.pct.five_hour?.mode === 'exact').toBe(false)
})

test('clears the open turn when the turn ends', async ($, on) => {
  const k = kit(on)
  await start($)
  await runTurn($, k, { turnId: 't1' })
  const file = JSON.parse(k.disk.files.get(`${SESSIONS}\\s1.json`)?.text ?? '{}')
  expect(file.openTurn).toBeNull()
})

test('names the chat from its transcript', async ($, on) => {
  const k = kit(on)
  await k.disk.write('C:\\Users\\u\\.claude\\projects\\C--work\\s1.jsonl', '{"type":"custom-title","customTitle":"Sidebar name","sessionId":"s1"}')
  await start($)
  await runTurn($, k, { turnId: 't1' })
  expect(JSON.parse(k.disk.files.get(`${SESSIONS}\\s1.json`)?.text ?? '{}').title).toBe('Sidebar name')
})

test('names an untitled chat by its first request', async ($, on) => {
  const k = kit(on)
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'please rename the token check everywhere in the project' })
  expect(JSON.parse(k.disk.files.get(`${SESSIONS}\\s1.json`)?.text ?? '{}').title).toBe('please rename the token check everywhere')
})

test('takes the freshest reading across chats as before', async ($, on) => {
  const k = kit(on)
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 20, week: 20 } })
  k.disk.now.ms = 1_300_000
  await k.disk.write(
    `${SESSIONS}\\other.json`,
    JSON.stringify(session({ sessionId: 'other', turns: [turn({ turnId: 'o1', startedAt: 1_200_000, endedAt: 1_300_000, readings: { before: reading(1_200_000, 20, 20), after: reading(1_300_000, 25, 20) } })] })),
  )
  await k.clock.advance(540_000)
  k.limits.five = 20
  await runTurn($, k, { turnId: 't2', after: { five: 26, week: 20 } })
  const t2 = savedTurns(k)[1]
  expect(t2?.readings.before?.five_hour?.pct).toBe(25)
  expect(t2?.readings.before?.at).toBe(1_300_000)
  expect(t2?.isParallel).toBe(false)
})

test('sees a long turn of another chat that started hours ago', async ($, on) => {
  const now = 10 * 3_600_000
  const k = kit(on, { now })
  k.disk.now.ms = now - 2 * 3_600_000
  await k.disk.write(`${SESSIONS}\\other.json`, JSON.stringify(session({ sessionId: 'other', openTurn: { turnId: 'long', startedAt: now - 2 * 3_600_000 } })))
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 30, week: 20 } })
  expect(savedTurns(k)[0]?.isParallel).toBe(true)
})

test('starts a new file after /clear', async ($, on) => {
  const k = kit(on)
  await start($)
  await runTurn($, k, { turnId: 't1' })
  k.sessionId = 's2'
  await runTurn($, k, { turnId: 't2' })
  expect(savedTurns(k).map(t => t.turnId)).toEqual(['t2'])
  expect(JSON.parse(k.disk.files.get(`${SESSIONS}\\s1.json`)?.text ?? '{}').turns.map((t: { turnId: string }) => t.turnId)).toEqual(['t1'])
})
