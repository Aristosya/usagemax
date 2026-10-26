import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { FooterEntry, FooterMode, FooterView, TurnRecord } from '../types'
import { diskOf } from './lib/disk'
import { footerText, severity, visibleTokens } from './lib/format'
import { readSettings } from './lib/settings'

const footers = atom({ plugin: 'usagemax', key: 'footers' } as const, [] as FooterEntry[])
const footerMode = atom({ plugin: 'usagemax', key: 'footerMode' } as const, 'text' as FooterMode)

/** Footers kept for answer blocks still on screen. */
const KEEP = 200
/** Characters of the answer's end a block must end with to get the row. */
const TAIL = 200

/** The 5-hour window's fill as a ring: the desktop draws no Svg in these places. */
export function ringGlyph(pct: number | null): string {
  if (pct === null || pct < 12.5) return '○'
  if (pct < 37.5) return '◔'
  if (pct < 62.5) return '◑'
  if (pct < 87.5) return '◕'
  return '●'
}

export function footerView(t: TurnRecord): FooterView {
  const pct5h = t.pct.five_hour?.v ?? null
  const tok = visibleTokens(t.tokens) + visibleTokens(t.agents.tokens)
  return {
    text: footerText({ pct5h, pctWeek: t.pct.seven_day?.v ?? null, tok, cached: t.tokens.cacheRead + t.agents.tokens.cacheRead }),
    ring: t.readings.after?.five_hour?.pct ?? null,
    severity: severity(pct5h),
  }
}

export function footerLine(v: FooterView): string {
  return `${ringGlyph(v.ring)} ${v.text}`
}

/** The text to show under the answer in text mode; otherwise keeps the row for the answer block. */
export async function footerAfterTurn($: EngineInterface, t: TurnRecord, answer: string): Promise<string | undefined> {
  const mode = (await readSettings(diskOf($))).footer
  await update($, footerMode, () => mode)
  const view = footerView(t)
  if (mode === 'text') return footerLine(view)
  const tail = answer.trimEnd().slice(-TAIL)
  if (tail !== '') await update($, footers, list => [...list, { tail, view }].slice(-KEEP))
  return undefined
}

export function footer(on: On): void {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const mode = await read($, footerMode)
    if (mode === 'text') return next(e)
    const text = e.props.text.trimEnd()
    const entry = [...(await read($, footers))].reverse().find(f => text.endsWith(f.tail))
    if (!entry) return next(e)
    const line = footerLine(entry.view)
    if (mode === 'rewrite') return next({ ...e, props: { ...e.props, text: `${e.props.text}\n\n\`${line}\`` } })
    const els = $.ui.resolve(e)
    if (!('Markdown' in els)) return next(e)
    const { Box, Text, Markdown } = els
    const color = entry.view.severity === 'alert' ? 'error' : entry.view.severity === 'warn' ? 'warning' : undefined
    return (
      <Box flexDirection="column">
        <Markdown text={e.props.text} />
        <Text size="caption" mono tabular dimColor={color === undefined} color={color}>
          {line}
        </Text>
      </Box>
    )
  })
}
