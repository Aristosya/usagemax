import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { session, turn } from './factory'
import { type Kit, kit, runTurn, savedTurns, start } from './kit'
import { HOME } from './memdisk'

const CONFIG = `${HOME}\\.claude.json`
const SESSIONS = `${HOME}\\.claude\\usagemax\\sessions`

const run = async ($: Engine, args: string) =>
  (await $.command.run({ command: 'usagemax', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text

const PANE = {
  plugin: 'usagemax',
  component: 'Pane',
  requestId: 'usagemax',
  surface: 'desktop',
  props: { title: 'usagemax', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

async function signIn(k: Kit, id: string, email: string) {
  await k.disk.write(CONFIG, JSON.stringify({ oauthAccount: { accountUuid: id, emailAddress: email } }))
}

/** Another chat of another account that worked today. */
async function otherAccountChat(k: Kit) {
  const at = k.clock.now() - 10 * 60_000
  const file = session({ sessionId: 'b1', title: 'Other account chat', turns: [turn({ turnId: 'b', startedAt: at - 1000, endedAt: at, account: 'acc-b' })] })
  await k.disk.write(`${SESSIONS}\\b1.json`, JSON.stringify(file))
}

test("keeps another account's chats out of the reports", async ($, on) => {
  const k = kit(on)
  await signIn(k, 'acc-a', 'a@example.com')
  await otherAccountChat(k)
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'my request', after: { five: 18, week: 20 } })
  const top = await run($, 'top today')
  expect(top).not.toContain('Other account chat')
})

test('marks each request with the account it ran under', async ($, on) => {
  const k = kit(on)
  await signIn(k, 'acc-a', 'a@example.com')
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 18, week: 20 } })
  expect(savedTurns(k)[0]?.account).toBe('acc-a')
})

test("takes the account from the chat's environment over a stale config file", async ($, on) => {
  const k = kit(on, { env: { CLAUDE_CODE_ACCOUNT_UUID: 'acc-b', CLAUDE_CODE_USER_EMAIL: 'b@example.com' } })
  await signIn(k, 'acc-a', 'a@example.com')
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 18, week: 20 } })
  expect(savedTurns(k)[0]?.account).toBe('acc-b')
  await run($, '')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /b@example\.com/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /a@example\.com/ })).toBeUndefined()
  await ui.unmount()
})

test('a chat that moved to another account keeps its earlier requests with the earlier account', async ($, on) => {
  const k = kit(on, { env: { CLAUDE_CODE_ACCOUNT_UUID: 'acc-b' } })
  await k.disk.write(`${HOME}\\.claude\\usagemax\\accounts.json`, JSON.stringify({ legacy: 'acc-a', resets: {} }))
  // acc-a's week, seen before the move; acc-b's week resets earlier, so it is another counter.
  const at = k.clock.now() - 600_000
  const old = turn({ turnId: 'old', prompt: 'old request', startedAt: at - 1000, endedAt: at, readings: { before: null, after: { at, seven_day: { pct: 76, resetsAt: '2026-10-29T03:00:00.000Z' } } } })
  await k.disk.write(`${SESSIONS}\\${k.sessionId}.json`, JSON.stringify(session({ sessionId: k.sessionId, turns: [old] })))
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'new request', after: { five: 18, week: 20 } })
  const chat = await run($, 'chat')
  expect(chat).toContain('new request')
  expect(chat).not.toContain('old request')
})

test("names the account in the panel and resets its statistics in two presses", async ($, on) => {
  const k = kit(on)
  await signIn(k, 'acc-a', 'a@example.com')
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'before the reset', after: { five: 18, week: 20 } })
  await run($, '')
  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /a@example\.com/ }))?.text).toContain('a@example.com')
  // The last requests read «HH:MM  prompt»; the chat's title keeps its first prompt either way.
  const lastLine = (prompt: string) => new RegExp(`^\\d\\d:\\d\\d\\s+${prompt}$`)
  await ui.press({ key: 'usagemax-reset' })
  expect(await ui.find({ type: 'Text', text: lastLine('before the reset') })).toBeDefined()
  await ui.press({ key: 'usagemax-reset-confirm' })
  await ui.unmount()
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: lastLine('before the reset') })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /statistics since|статистика с/ }))?.text).toMatch(/a@example\.com/)
  await ui.unmount()
  await k.clock.advance(60_000)
  await runTurn($, k, { turnId: 't2', text: 'after the reset', after: { five: 19, week: 20 } })
  ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: lastLine('after the reset') })).toBeDefined()
  await ui.unmount()
})

test('a reset of one account leaves another account alone', async ($, on) => {
  const k = kit(on)
  await signIn(k, 'acc-a', 'a@example.com')
  await k.disk.write(`${HOME}\\.claude\\usagemax\\accounts.json`, JSON.stringify({ legacy: 'acc-a', resets: { 'acc-b': k.clock.now() + 3_600_000 } }))
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'kept', after: { five: 18, week: 20 } })
  expect(await run($, 'chat')).toContain('kept')
})
