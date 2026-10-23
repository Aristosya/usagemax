import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { type Kit, USAGE, kit, runTurn, start } from './kit'

const run = async ($: Engine, args: string) =>
  (await $.command.run({ command: 'usagemax', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text

async function twoTurns($: Engine, k: Kit) {
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'rename the token check', after: { five: 18, week: 20 } })
  const heavier = { ...USAGE, output_tokens: 30_000 }
  await runTurn($, k, { turnId: 't2', text: 'rewrite the login flow', usage: heavier, after: { five: 30, week: 21 } })
}

test('registers /usagemax at start', async ($, on) => {
  const k = kit(on)
  await start($)
  expect(k.registered).toContain('usagemax')
})

test('opens the panel', async ($, on) => {
  const k = kit(on)
  await start($)
  await run($, '')
  expect(k.opened).toEqual(['usagemax'])
})

test('prints the full top for today', async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  const text = await run($, 'top')
  expect(text).toStartWith('Топ чатов: Сегодня')
  expect(text).toContain('1. rename the token check')
  expect(text).toContain('rewrite the login flow')
})

test('maps 5h to the window period', async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  expect(await run($, 'top 5h')).toStartWith('Топ чатов: Окно 5 ч')
  expect(await run($, 'hour')).toStartWith('Топ чатов: Час')
  expect(await run($, 'top yesterday')).toStartWith('Топ чатов: Вчера')
})

test("prints this chat's requests", async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  const text = await run($, 'chat')
  expect(text).toStartWith('Запросы этого чата')
  expect(text).toContain('rename the token check')
  expect(text).toContain('rewrite the login flow')
})

test('answers help for unknown arguments', async ($, on) => {
  kit(on)
  await start($)
  expect(await run($, 'what')).toStartWith('Команды: /usagemax')
})
