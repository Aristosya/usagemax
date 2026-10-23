import { expect, test } from 'claude-code/testing'

import { footerLine, footerView, ringGlyph } from '../hooks/footer'
import { reading, turn } from './factory'
import { kit, runTurn, seed, start } from './kit'
import { HOME } from './memdisk'

const MESSAGE = (text: string) =>
  ({ plugin: 'usagemax', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, surface: 'desktop' }) as const

test('draws the ring as a glyph by fill', () => {
  expect(ringGlyph(null)).toBe('○')
  expect(ringGlyph(5)).toBe('○')
  expect(ringGlyph(30)).toBe('◔')
  expect(ringGlyph(50)).toBe('◑')
  expect(ringGlyph(80)).toBe('◕')
  expect(ringGlyph(95)).toBe('●')
})

test('builds the view from a saved turn, agents included', () => {
  const view = footerView(
    turn({
      tokens: { in: 1000, out: 3000, cacheRead: 100_000, cacheWrite: 5000 },
      agents: { tokens: { in: 0, out: 1000, cacheRead: 0, cacheWrite: 0 }, count: 1 },
      readings: { before: reading(0, 7, 20), after: reading(1, 30, 20) },
      pct: { five_hour: { v: 3.4, mode: 'estimate' }, seven_day: { v: 0.21, mode: 'estimate' } },
    }),
  )
  expect(view).toEqual({ text: 'Used: +3.4%/+0.21% 10K Tok', ring: 30, severity: 'warn' })
  expect(footerLine(view)).toBe('◔ Used: +3.4%/+0.21% 10K Tok')
  expect(footerView(turn({ pct: { five_hour: { v: 6.1, mode: 'estimate' }, seven_day: null } })).severity).toBe('alert')
})

test('shows the footer under the answer', async ($, on) => {
  const k = kit(on)
  await seed(k)
  await start($)
  const r = await runTurn($, k, { turnId: 't1', after: { five: 18, week: 20 } })
  expect(r.text).toBe('◔ Used: +11.0%/– 9K Tok')
})

test('shows only tokens without limits', async ($, on) => {
  const k = kit(on)
  k.limits.five = null
  k.limits.week = null
  await start($)
  const r = await runTurn($, k, { turnId: 't1', after: { five: null, week: null } })
  expect(r.text).toBe('○ Used: 9K Tok')
})

test('draws the row under the matching block in tree mode', async ($, on) => {
  const k = kit(on)
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await k.disk.write(`${HOME}\\.claude\\usagemax\\settings.json`, '{"footer":"tree"}')
  await seed(k)
  await start($)
  const r = await runTurn($, k, { turnId: 't1', after: { five: 18, week: 20 } })
  expect(r.text).toBe('')
  const ui = await $.ui.mount(MESSAGE('All set.\n\nDone.'))
  expect((await ui.find({ type: 'Text', text: /Used:/ }))?.text).toBe('◔ Used: +11.0%/– 9K Tok')
  await ui.unmount()
  const other = await $.ui.mount(MESSAGE('Something else'))
  expect((await other.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await other.unmount()
})

test('adds the line inside the Markdown in rewrite mode', async ($, on) => {
  const k = kit(on)
  let seen = ''
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    seen = e.props.text
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  await k.disk.write(`${HOME}\\.claude\\usagemax\\settings.json`, '{"footer":"rewrite"}')
  await seed(k)
  await start($)
  await runTurn($, k, { turnId: 't1', after: { five: 18, week: 20 } })
  const ui = await $.ui.mount(MESSAGE('Done.'))
  expect(seen).toBe('Done.\n\n`◔ Used: +11.0%/– 9K Tok`')
  await ui.unmount()
})
