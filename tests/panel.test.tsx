import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { reading, session, turn } from './factory'
import { type Kit, USAGE, kit, runTurn, seed, start } from './kit'
import { SESSIONS } from './memdisk'

const PANE = {
  plugin: 'usagemax',
  component: 'Pane',
  requestId: 'usagemax',
  surface: 'desktop',
  props: { title: 'Расход лимитов', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

async function openViaButton($: Engine) {
  const button = await $.ui.mount({
    plugin: 'usagemax',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    surface: 'desktop',
  })
  await button.pointer({ type: 'down', x: 2, y: 0, button: 'left', in: 'usagemax-band' })
  await button.pointer({ type: 'up', x: 2, y: 0, button: 'left', in: 'usagemax-band' })
  await button.unmount()
}

type DrawnNode = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The texts of the Text children of the Box drawn under `key`, in order. */
function cellsOf(node: unknown, key: string): string[] {
  const find = (n: unknown): DrawnNode | undefined => {
    if (typeof n !== 'object' || n === null) return undefined
    const el = n as DrawnNode
    if (el.props?.key === key) return el
    for (const c of el.children ?? []) {
      const hit = find(c)
      if (hit) return hit
    }
    return undefined
  }
  const box = find(node)
  const textOf = (n: unknown): string => (typeof n === 'string' ? n : ((n as DrawnNode).children ?? []).map(textOf).join(''))
  return (box?.children ?? []).filter(c => typeof c === 'object' && (c as DrawnNode).type === 'Text').map(textOf)
}

async function texts($: Engine): Promise<string[]> {
  const ui = await $.ui.mount(PANE)
  const all = (await ui.findAll({ type: 'Text' })).map(x => x.text)
  await ui.unmount()
  return all
}

async function twoTurns($: Engine, k: Kit) {
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'rename the token check', after: { five: 18, week: 20 } })
  k.limits.five = 25
  await runTurn($, k, { turnId: 't2', text: 'rewrite the login flow', after: { five: 26, week: 21 } })
}

test('lays out the window, limits, this chat, the top and last requests in order', async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  await openViaButton($)
  const all = await texts($)
  const at = (label: string) => all.findIndex(x => x === label)
  expect(at('ОКНО 5 Ч') >= 0).toBe(true)
  expect(at('ОКНО 5 Ч') < at('ЛИМИТЫ')).toBe(true)
  expect(at('ЛИМИТЫ') < at('ЭТОТ ЧАТ')).toBe(true)
  expect(at('ЭТОТ ЧАТ') < at('ТОП ЧАТОВ · СЕГОДНЯ')).toBe(true)
  expect(at('ТОП ЧАТОВ · СЕГОДНЯ') < at('ПОСЛЕДНИЕ ЗАПРОСЫ')).toBe(true)
  expect(all).toContain('26%')
  expect(all).toContain('74% осталось')
  expect(all).toContain('2 запроса')
  expect(all.some(x => /^━+$/.test(x))).toBe(true)
  expect(all.some(x => x.includes('rewrite the login flow'))).toBe(true)
})

test('shows one share per period: a day shows the weekly share only', async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  await openViaButton($)
  const ui = await $.ui.mount(PANE)
  const all = (await ui.findAll({ type: 'Text' })).map(x => x.text)
  expect(all).toContain('% НЕДЕЛИ')
  const header = all.indexOf('% НЕДЕЛИ')
  const row = all.findIndex((x, i) => i > header && x === 'rename the token check')
  expect(row > header).toBe(true)
  expect(all[row + 1]).toMatch(/^(\d+\.\d\d%|<0\.01%|–)$/)
  await ui.press({ key: 'period-hour' })
  const hour = (await ui.findAll({ type: 'Text' })).map(x => x.text)
  expect(hour).toContain('% ОКНА 5 Ч')
  await ui.unmount()
})

test('names its build at the bottom', async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  await openViaButton($)
  expect((await texts($)).at(-1)).toBe('usagemax 0.5.8')
})

test('places pace, trend, activity and models in their order', async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  await openViaButton($)
  const all = await texts($)
  const at = (label: string) => all.indexOf(label)
  expect(at('ОКНО 5 Ч') < at('ТЕМП')).toBe(true)
  expect(at('ТЕМП') < at('ЛИМИТЫ')).toBe(true)
  expect(at('ЛИМИТЫ') < at('ТРЕНД · 7 ДНЕЙ')).toBe(true)
  expect(at('ТРЕНД · 7 ДНЕЙ') < at('АКТИВНОСТЬ · ЧАСЫ')).toBe(true)
  expect(at('АКТИВНОСТЬ · ЧАСЫ') < at('ЭТОТ ЧАТ')).toBe(true)
  expect(at('ЭТОТ ЧАТ') < at('МОДЕЛИ · СЕГОДНЯ')).toBe(true)
  expect(at('МОДЕЛИ · СЕГОДНЯ') < at('ТОП ЧАТОВ · СЕГОДНЯ')).toBe(true)
  expect(all).toContain('Занято')
  expect(all).toContain('Прошло времени')
  expect(all).toContain('Opus 5.5 100%')
  expect(all.some(x => x.includes('новое'))).toBe(false)
})

test("takes the freshest reading of any chat for the headline, not this chat's last response", async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  await k.clock.advance(1000)
  const now = k.clock.now()
  k.disk.now.ms = now
  await k.disk.write(
    `${SESSIONS}\\other.json`,
    JSON.stringify(session({ sessionId: 'other', turns: [turn({ turnId: 'o1', startedAt: now - 1000, endedAt: now, readings: { before: null, after: reading(now, 61, 30) } })] })),
  )
  k.limits.five = 26
  await openViaButton($)
  const all = await texts($)
  expect(all).toContain('61%')
  expect(all).toContain('39% осталось')
})

test('lines the hour labels up with the heatmap columns', async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  await openViaButton($)
  const ui = await $.ui.mount(PANE)
  const tree = await ui.drawn()
  for (let row = 0; row < 7; row += 1) {
    const cells = cellsOf(tree, `heat-row-${row}`)
    expect(cells).toHaveLength(25)
    expect(cells.slice(1).every(c => c === '█')).toBe(true)
  }
  for (let row = 0; row < 7; row += 1) expect(cellsOf(tree, `heat-row-${row}`)[0]).toHaveLength(3)
  const axis = cellsOf(tree, 'heat-axis')
  expect(axis[0]).toHaveLength(3)
  expect(axis).toHaveLength(25)
  expect(axis[1]).toBe('0')
  expect(axis[7]).toBe('6')
  expect(axis[13]! + axis[14]!).toBe('12')
  expect(axis[19]! + axis[20]!).toBe('18')
  expect(axis[23]! + axis[24]!).toBe('23')
  await ui.unmount()
})

test('draws the period switch as one row of buttons', async ($, on) => {
  const k = kit(on)
  await twoTurns($, k)
  await openViaButton($)
  const ui = await $.ui.mount(PANE)
  const buttons = (await ui.findAll({ type: 'Button' })).filter(b => String(b.props.key ?? '').startsWith('period-'))
  expect(buttons.map(b => b.props.label)).toEqual(['Час', 'Сегодня', 'Вчера', 'Окно 5 ч', 'Неделя'])
  expect(buttons.find(b => b.props.label === 'Сегодня')?.props.variant).toBe('primary')
  await ui.unmount()
})

test('lists other usage as a row', async ($, on) => {
  const k = kit(on)
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 18, week: 20 } })
  const small = { ...USAGE, input_tokens: 100, output_tokens: 300, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 500 }
  await runTurn($, k, { turnId: 't2', usage: small, after: { five: 26, week: 20 } })
  await openViaButton($)
  expect((await texts($)).some(x => x.includes('Прочее (Chat, другие устройства)'))).toBe(true)
})

test('switches the top period', async ($, on) => {
  const now = Date.parse('2026-10-22T08:00:00.000Z')
  const k = kit(on, { now })
  const yesterday = now - 86_400_000
  await k.disk.write(
    `${SESSIONS}\\other.json`,
    JSON.stringify(session({ sessionId: 'other', title: 'Weekly heavy', turns: [turn({ startedAt: yesterday, endedAt: yesterday + 1, pct: { five_hour: { v: 1, mode: 'estimate' }, seven_day: { v: 5, mode: 'estimate' } } })] })),
  )
  await twoTurns($, k)
  await openViaButton($)
  expect((await texts($)).some(x => x.includes('Weekly heavy'))).toBe(false)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'period-week' })
  expect((await ui.findAll({ type: 'Text' })).some(x => x.text.includes('Weekly heavy'))).toBe(true)
  await ui.unmount()
})

test('shows ten last requests', async ($, on) => {
  const k = kit(on)
  await start($)
  for (let i = 0; i < 12; i += 1) await runTurn($, k, { turnId: `t${i}`, text: `request number ${i}` })
  await openViaButton($)
  expect((await texts($)).filter(x => /^\d\d:\d\d .*request number/.test(x)).length).toBe(10)
})

test('says the chat has no requests yet', async ($, on) => {
  kit(on)
  await start($)
  await openViaButton($)
  const all = await texts($)
  expect(all.some(x => x === 'В этом чате пока нет запросов')).toBe(true)
  expect(all.some(x => x.includes('0 Tok'))).toBe(false)
})

test('labels rows recorded from engine messages before the cleanup', async ($, on) => {
  const k = kit(on)
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'placeholder' })
  const path = `${SESSIONS}\\s1.json`
  const file = JSON.parse(k.disk.files.get(path)?.text ?? '{}')
  file.turns[0].prompt = '<cross-session-message from="uds:pipe" from-session="local_4edaebfc-d1'
  await k.disk.write(path, JSON.stringify(file))
  await openViaButton($)
  const all = await texts($)
  expect(all.some(x => x.includes('Сообщение из другой сессии'))).toBe(true)
  expect(all.some(x => x.includes('<cross-session-message'))).toBe(false)
})

test("heals another chat's title saved with question marks", async ($, on) => {
  const k = kit(on)
  const now = k.clock.now()
  const known = { five_hour: { v: 1, mode: 'estimate' }, seven_day: { v: 0.1, mode: 'estimate' } } as const
  await k.disk.write(
    `${SESSIONS}\\o1.json`,
    JSON.stringify(session({ sessionId: 'o1', cwd: 'C:\\other', title: '.NET ???????', turns: [turn({ startedAt: now - 2000, endedAt: now - 1000, pct: known })] })),
  )
  await k.disk.write('C:\\Users\\u\\.claude\\projects\\C--other\\o1.jsonl', '{"type":"custom-title","customTitle":".NET Главный","sessionId":"o1"}')
  await start($)
  await openViaButton($)
  const all = await texts($)
  expect(all.some(x => x.includes('.NET Главный'))).toBe(true)
  expect(all.some(x => x.includes('???'))).toBe(false)
})

test('keeps a real question mark in a title', async ($, on) => {
  const k = kit(on)
  const now = k.clock.now()
  const known = { five_hour: { v: 1, mode: 'estimate' }, seven_day: { v: 0.1, mode: 'estimate' } } as const
  await k.disk.write(
    `${SESSIONS}\\o2.json`,
    JSON.stringify(session({ sessionId: 'o2', cwd: 'C:\\other', title: 'Почему падает CI?', turns: [turn({ startedAt: now - 2000, endedAt: now - 1000, pct: known })] })),
  )
  await start($)
  await openViaButton($)
  expect((await texts($)).some(x => x.includes('Почему падает CI?'))).toBe(true)
  expect(k.disk.commands.some(c => (c.at(-1) ?? '').includes('o2.jsonl'))).toBe(false)
})

test('says there is no data before opening', async ($, on) => {
  kit(on)
  await start($)
  expect((await texts($)).some(x => x.includes('Пока нет данных'))).toBe(true)
})
