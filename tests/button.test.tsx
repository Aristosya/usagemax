import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { type Kit, kit, runTurn, seed, start } from './kit'
import { HOME } from './memdisk'

const BAND = (hasSurvey = false, bodyColumns = 200) =>
  ({
    plugin: 'usagemax',
    component: 'AbovePrompt',
    props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    surface: 'desktop',
  }) as const
const MODE = (modes: string[]) => ({ plugin: 'usagemax', component: 'SessionMode', props: { modes }, surface: 'desktop' }) as const
const CLIENT = 'usagemax-band'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
type Drawn = { type: string; text: string; props: Record<string, unknown> }

/** Every Text and Box the band's surface module drew, in order. */
function walk(n: unknown, out: Drawn[] = []): Drawn[] {
  if (typeof n !== 'object' || n === null) return out
  const el = n as Node
  const text = el.type === 'Text' ? (el.children ?? []).map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')).join('') : ''
  if (el.type === 'Text' || el.type === 'Box') out.push({ type: el.type, text, props: el.props ?? {} })
  if (el.type !== 'Text') for (const c of el.children ?? []) walk(c, out)
  return out
}

async function band($: Engine): Promise<Drawn[]> {
  const ui = await $.ui.mount(BAND())
  const drawn = walk(await ui.drawn({ in: CLIENT }))
  await ui.unmount()
  return drawn
}

const texts = (d: Drawn[]) => d.filter(x => x.type === 'Text')
const text = (d: Drawn[], match: string | RegExp) => texts(d).find(x => (typeof match === 'string' ? x.text === match : match.test(x.text)))

async function afterOneTurn($: Engine, on: Parameters<typeof kit>[0], after = { five: 18, week: 20 }): Promise<Kit> {
  const k = kit(on)
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', after })
  return k
}

test("draws the band as one surface module: orange ring and this chat's share in an orange round border", async ($, on) => {
  await afterOneTurn($, on)
  const d = await band($)
  expect(text(d, '◔')?.props.color).toBe('claude')
  expect(text(d, '11.0%')?.props.bold).toBe(true)
  const chip = d.find(x => x.type === 'Box' && x.props.borderStyle === 'round')
  expect(chip?.props.borderColor).toBe('claude')
})

test('fills the band: 5-hour window and week with a bar, percent and time to reset', async ($, on) => {
  await afterOneTurn($, on)
  const d = await band($)
  expect(text(d, '5 ч')?.text).toBe('5 ч')
  expect(text(d, 'неделя')?.text).toBe('неделя')
  expect(text(d, '18%')?.props.bold).toBe(true)
  expect(text(d, '20%')?.props.bold).toBe(true)
  const barColors = texts(d).filter(x => /^━+$/.test(x.text)).map(x => x.props.color).filter(c => c !== undefined)
  expect(barColors).toEqual(['claude', 'permission'])
  expect(text(d, /^\d+ д \d+ ч$/)?.text).toMatch(/д/)
})

test('keeps the warning out of the band in the first minutes after a reset', async ($, on) => {
  // 15:37 reset, 15:42 at 6% and 2%: five minutes said "runs out at 17:12" and "at 19:37".
  const k = await afterOneTurn($, on, { five: 1, week: 0 })
  await runTurn($, k, { turnId: 't2', after: { five: 6, week: 2 } })
  expect(text(await band($), /кончится/)).toBeUndefined()
})

test('keeps the warning out of the band while the window lasts', async ($, on) => {
  await afterOneTurn($, on, { five: 7, week: 20 })
  const d = await band($)
  expect(text(d, '7%')?.text).toBe('7%')
  expect(text(d, /кончится/)).toBeUndefined()
})

test('warns in the band when the 5-hour window runs out before its reset', async ($, on) => {
  const k = await afterOneTurn($, on, { five: 20, week: 20 })
  // The forecast wants a quarter of an hour of readings inside the window.
  await k.clock.advance(15 * 60_000)
  await runTurn($, k, { turnId: 't2', after: { five: 60, week: 21 } })
  const d = await band($)
  expect(text(d, /^▲ кончится ≈\d\d:\d\d$/)?.props.color).toBe('warning')
})

test('warns about the week next to the week when it runs out before its reset', async ($, on) => {
  const k = await afterOneTurn($, on, { five: 7, week: 50 })
  // The week's forecast wants six hours of readings inside the week.
  await k.clock.advance(6 * 3_600_000)
  await runTurn($, k, { turnId: 't2', after: { five: 7, week: 90 } })
  const all = texts(await band($)).map(x => x.text)
  const warnings = all.filter(x => x.includes('кончится ≈'))
  expect(warnings).toHaveLength(1)
  expect(all.indexOf(warnings[0] ?? '')).toBeGreaterThan(all.indexOf('неделя'))
})

test('fits a narrow band on one row by dropping the bars and the times to reset', async ($, on) => {
  await afterOneTurn($, on)
  const ui = await $.ui.mount(BAND(false, 30))
  const d = walk(await ui.drawn({ in: CLIENT }))
  await ui.unmount()
  expect(texts(d).filter(x => /━/.test(x.text))).toEqual([])
  expect(text(d, /^\d+ д \d+ ч$/)).toBeUndefined()
  expect(text(d, '18%')?.text).toBe('18%')
})

test('speaks English when Claude Code has no language set', async ($, on) => {
  const k = kit(on, { language: null })
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 18, week: 20 } })
  const d = await band($)
  expect(text(d, '5h')?.text).toBe('5h')
  expect(text(d, 'week')?.text).toBe('week')
  expect(text(d, '5 ч')).toBeUndefined()
})

test('fills the ring when the first request starts, before its answer', async ($, on) => {
  const k = kit(on)
  const at = k.clock.now() - 100_000
  const reading = { at, five_hour: { pct: 30, resetsAt: '2099-01-01T00:00:00Z' }, seven_day: { pct: 20, resetsAt: '2099-01-05T00:00:00Z' } }
  const turn = { turnId: 'o1', startedAt: at - 1000, endedAt: at, prompt: 'other', model: 'claude-opus-5-5', tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, agents: { tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, count: 0 }, units: 0, readings: { before: reading, after: reading }, pct: {}, isParallel: false, reason: 'answer' }
  await k.disk.write(`${HOME}\\.claude\\usagemax\\sessions\\other.json`, JSON.stringify({ v: 1, sessionId: 'other', title: 'Other', cwd: 'C:\\other', startedAt: 0, openTurn: null, agentTurns: {}, turns: [turn] }))
  await start($)
  await $.turn.start({ text: 'first', turnId: 't1' })
  const d = await band($)
  expect(text(d, '◔')?.text).toBe('◔')
  expect(text(d, '–')?.text).toBe('–')
})

test('shows an empty ring before the first request', async ($, on) => {
  kit(on)
  await start($)
  const d = await band($)
  expect(text(d, '○')?.text).toBe('○')
  expect(text(d, '–')?.text).toBe('–')
})

/** Another chat's answer, written to its own file: what the band picks up between this chat's answers. */
async function otherChatAnswered(k: Kit, five: number, resetsInMs: number): Promise<void> {
  const at = k.clock.now()
  const reading = { at, five_hour: { pct: five, resetsAt: new Date(at + resetsInMs).toISOString() }, seven_day: { pct: 20, resetsAt: '2099-01-05T00:00:00Z' } }
  const turn = { turnId: 'o1', startedAt: at - 1000, endedAt: at, prompt: 'other', model: 'claude-opus-5-5', tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, agents: { tokens: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, count: 0 }, units: 0, readings: { before: reading, after: reading }, pct: {}, isParallel: false, reason: 'answer' }
  await k.disk.write(`${HOME}\\.claude\\usagemax\\sessions\\other.json`, JSON.stringify({ v: 1, sessionId: 'other', title: 'Other', cwd: 'C:\\other', startedAt: 0, openTurn: null, agentTurns: {}, turns: [turn] }))
}

test("picks up another chat's newer reading within a minute, with no answer here", async ($, on) => {
  const k = kit(on)
  await start($)
  await otherChatAnswered(k, 40, 3 * 3_600_000)
  expect(text(await band($), '40%')).toBeUndefined()
  await k.clock.advance(60_000)
  expect(text(await band($), '40%')?.props.bold).toBe(true)
})

test('counts the time to reset down every minute', async ($, on) => {
  const k = kit(on)
  await start($)
  await otherChatAnswered(k, 40, 3 * 3_600_000)
  await k.clock.advance(60_000)
  expect(text(await band($), '2 ч 59 мин')?.text).toBe('2 ч 59 мин')
  await k.clock.advance(60_000)
  expect(text(await band($), '2 ч 58 мин')?.text).toBe('2 ч 58 мин')
})

test('lights the whole band up while the pointer is over it', async ($, on) => {
  await afterOneTurn($, on)
  const ui = await $.ui.mount(BAND())
  const root = async () => walk(await ui.drawn({ in: CLIENT })).find(x => x.type === 'Box')
  expect((await root())?.props.backgroundColor).toBeUndefined()
  await ui.pointer({ type: 'enter', x: 10, y: 0, in: CLIENT })
  expect((await root())?.props.backgroundColor).toBe('#2c2c2c')
  await ui.pointer({ type: 'leave', x: 10, y: 0, in: CLIENT })
  expect((await root())?.props.backgroundColor).toBeUndefined()
  await ui.unmount()
})

test('opens the panel on a click anywhere in the band', async ($, on) => {
  const k = await afterOneTurn($, on)
  const ui = await $.ui.mount(BAND())
  await ui.pointer({ type: 'down', x: 40, y: 0, button: 'left', in: CLIENT })
  await ui.pointer({ type: 'up', x: 40, y: 0, button: 'left', in: CLIENT })
  expect(k.opened).toEqual(['usagemax'])
  await ui.unmount()
})

test('leaves a right click on the band alone', async ($, on) => {
  const k = await afterOneTurn($, on)
  const ui = await $.ui.mount(BAND())
  await ui.pointer({ type: 'down', x: 4, y: 0, button: 'right', in: CLIENT })
  await ui.pointer({ type: 'up', x: 4, y: 0, button: 'right', in: CLIENT })
  expect(k.opened).toEqual([])
  await ui.unmount()
})

test('opens nothing for a message that does not ask to open', async ($, on) => {
  const k = await afterOneTurn($, on)
  const ui = await $.ui.mount(BAND())
  await ui.post({ open: 'yes' }, { in: CLIENT })
  expect(k.opened).toEqual([])
  await ui.unmount()
})

test('gives the band to a survey', async ($, on) => {
  kit(on)
  // Nothing draws beneath the plugin in a test: this hook stands for the engine.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  const ui = await $.ui.mount(BAND(true))
  expect(await ui.find({ type: 'Client', key: CLIENT })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
  await ui.unmount()
})

test('leaves the footer next to the model picker to the engine', async ($, on) => {
  kit(on)
  // Nothing draws beneath the plugin in a test: this hook stands for the engine.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($)
  const ui = await $.ui.mount(MODE(['focus']))
  expect(await ui.find({ type: 'Button', key: 'usagemax-button' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: 'engine' }))?.text).toBe('engine')
  await ui.unmount()
})
