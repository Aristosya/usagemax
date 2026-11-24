import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { WEEK, WINDOW_A, session, turn } from './factory'
import { type Kit, kit, runTurn, seed, start } from './kit'
import { SESSIONS } from './memdisk'

const BAND = {
  plugin: 'usagemax',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  surface: 'desktop',
} as const
const PANE = {
  plugin: 'usagemax',
  component: 'Pane',
  requestId: 'usagemax',
  surface: 'desktop',
  props: { title: 'usagemax', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

/** The texts the band's surface module drew, in order. */
function bandTexts(n: unknown, out: string[] = []): string[] {
  if (typeof n !== 'object' || n === null) return out
  const el = n as Node
  if (el.type === 'Text') out.push((el.children ?? []).map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')).join(''))
  else for (const c of el.children ?? []) bandTexts(c, out)
  return out
}

async function band($: Engine): Promise<string[]> {
  const ui = await $.ui.mount(BAND)
  const drawn = bandTexts(await ui.drawn({ in: 'usagemax-band' }))
  await ui.unmount()
  return drawn
}

async function panelTexts($: Engine): Promise<string[]> {
  await $.command.run({ command: 'usagemax', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const ui = await $.ui.mount(PANE)
  const all = (await ui.findAll({ type: 'Text' })).map(x => x.text)
  await ui.unmount()
  return all
}

/** What the engine pushes when a window moves a whole point, mid-request included. */
const measure = ($: Engine, k: Kit, week: number, five: number | null) =>
  $.session.measure({
    context: { window: 1_000_000 },
    rateLimits: [...(five === null ? [] : [{ kind: 'five_hour', percentUsed: five, resetsAt: k.limits.fiveResets }]), { kind: 'seven_day', percentUsed: week, resetsAt: WEEK }],
    changed: ['rateLimits'],
  })

/** An earlier chat on a plan with the week only: the week grew 5 points over 5 requests of one unit each. */
async function weekHistory(k: Kit) {
  const base = k.clock.now() - 3_600_000
  const turns = [0, 1, 2, 3, 4, 5].map(i => {
    const at = base + i * 60_000
    return turn({ turnId: `h${i}`, startedAt: at - 1000, endedAt: at, units: 1, readings: { before: null, after: { at, seven_day: { pct: 10 + i, resetsAt: WEEK } } } })
  })
  await k.disk.write(`${SESSIONS}\\history.json`, JSON.stringify(session({ sessionId: 'history', title: 'History', turns })))
}

test('moves the band as soon as a limit moves in the middle of a request', async ($, on) => {
  const k = kit(on)
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 18, week: 78 } })
  await $.turn.start({ text: 'a long request', turnId: 't2' })
  await measure($, k, 80, 19)
  const d = await band($)
  expect(d).toContain('80%')
  expect(d).not.toContain('78%')
})

test('shows another chat the reading a running request measured', async ($, on) => {
  const k = kit(on)
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 18, week: 78 } })
  const at = k.clock.now() + 1000
  const live = { account: 'default', reading: { at, five_hour: { pct: 19, resetsAt: WINDOW_A }, seven_day: { pct: 80, resetsAt: WEEK } } }
  k.disk.now.ms = at
  await k.disk.write(`${SESSIONS}\\other.json`, JSON.stringify({ ...session({ sessionId: 'other', title: 'Other chat', turns: [] }), live }))
  await k.clock.advance(60_000)
  expect(await band($)).toContain('80%')
})

test("shows this chat's weekly share on the band when the plan has no 5-hour window", async ($, on) => {
  const k = kit(on)
  await seed(k)
  await weekHistory(k)
  k.limits.five = null
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: null, week: 20 } })
  await runTurn($, k, { turnId: 't2', after: { five: null, week: 21 } })
  const d = await band($)
  expect(d).not.toContain('–')
  expect(d.some(x => /^(\d+\.\d\d%|<0\.01%)$/.test(x))).toBe(true)
  expect(d).toContain('◔')
  expect(d).not.toContain('5 ч')
})

test('writes the weekly share alone under an answer when the plan has no 5-hour window', async ($, on) => {
  const k = kit(on)
  await seed(k)
  await weekHistory(k)
  k.limits.five = null
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: null, week: 20 } })
  const r = await runTurn($, k, { turnId: 't2', after: { five: null, week: 21 } })
  expect(r.text).toMatch(/^◔ Used: (\+\d+\.\d\d%|<0\.01%) of the week 9K Tok · 100K cached$/)
})

test('draws the weekly limit and this chat from the newest reading once the 5-hour window is gone', async ($, on) => {
  const k = kit(on)
  // seed() leaves an older reading that still had a 5-hour window.
  await seed(k)
  await weekHistory(k)
  k.limits.five = null
  await start($)
  await runTurn($, k, { turnId: 't1', text: 'first request', after: { five: null, week: 20 } })
  await runTurn($, k, { turnId: 't2', text: 'second request', after: { five: null, week: 21 } })
  const all = await panelTexts($)
  expect(all).toContain('НЕДЕЛЬНЫЙ ЛИМИТ')
  expect(all).not.toContain('ЛИМИТ 5 ЧАСОВ')
  expect(all).toContain('21%')
  expect(all).toContain('2 запроса')
  expect(all.some(x => /^(\d+\.\d\d%|<0\.01%) от недельного лимита$/.test(x))).toBe(true)
  const row = all.findIndex(x => /^\d\d:\d\d\s+second request$/.test(x))
  expect(all[row + 1]).toMatch(/^(\+\d+\.\d\d%|<0\.01%) · \d+K$/)
})

test('offers no 5-hour period when the plan has no 5-hour window', async ($, on) => {
  const k = kit(on)
  await weekHistory(k)
  k.limits.five = null
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: null, week: 20 } })
  await $.command.run({ command: 'usagemax', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const ui = await $.ui.mount(PANE)
  const keys = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.key ?? ''))
  expect(keys).not.toContain('period-window5h')
  await ui.press({ key: 'period-hour' })
  const all = (await ui.findAll({ type: 'Text' })).map(x => x.text)
  expect(all).toContain('% НЕДЕЛИ')
  await ui.unmount()
})
