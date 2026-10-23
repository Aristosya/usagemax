import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { BandLimit, BandView, ButtonState, Rate, Reading, SessionFile, WindowReading } from '../types'
import { ringGlyph } from './footer'
import { formatPct5h } from './lib/format'
import { type Lang, type MsgKey, formatDuration, langOf, t } from './lib/i18n'
import { forecast, sessionSummary, weekForecast } from './lib/report'
import { clock, openPanel } from './panel'

const button = atom({ plugin: 'usagemax', key: 'button' } as const, { ring: null, sessionPct: null } as ButtonState)
/** Set when the band's surface module failed: the band is drawn as Text from then on. */
const bandFailed = atom({ plugin: 'usagemax', key: 'bandFailed' } as const, false)

/** The theme's accent: the chip's border and ring, the 5-hour bar. */
const ACCENT = 'claude'
const WEEK_COLOR = 'permission'
/** Characters in each limit bar of the band. */
const BAR_WIDTH = 8
const CHIP_KEY = 'usagemax-button'
const BAND_KEY = 'usagemax-band'
const DAY_MS = 86_400_000

/**
 * Puts this chat's share of the current 5-hour window, both windows and their run-out forecasts in the band.
 * The windows are the account's, so the forecasts read every chat's readings the caller has at hand.
 */
export async function updateButton($: EngineInterface, file: SessionFile, current: Reading | null, rate: Rate, others: readonly SessionFile[] = []): Promise<void> {
  const summary = sessionSummary(file, current, rate)
  const readings = [
    ...[file, ...others].flatMap(f => f.turns.flatMap(x => [x.readings.before, x.readings.after])).filter((x): x is Reading => x !== null),
    ...(current ? [current] : []),
  ]
  const five = current ? forecast(readings, current.at) : null
  const week = current ? weekForecast(readings, current.at) : null
  const value: ButtonState = {
    ring: current?.five_hour?.pct ?? null,
    sessionPct: summary.unknown?.five_hour ? null : summary.pct5h,
    five: current?.five_hour ?? null,
    week: current?.seven_day ?? null,
    fiveRunsOutAt: five?.kind === 'runsOutAt' ? five.at : null,
    weekRunsOutAt: week?.kind === 'runsOutAt' ? week.at : null,
    lang: await langOf($),
  }
  await update($, button, () => value)
}

function shareText(b: ButtonState): string {
  return b.sessionPct === null ? '–' : formatPct5h(b.sessionPct).replace('+', '')
}

/** `18:20` today, `Fr 15:30` on another day. */
function whenText(at: number, now: number, tz: number, lang: Lang): string {
  const day = (ms: number) => Math.floor((ms + tz * 60_000) / DAY_MS)
  if (day(at) === day(now)) return clock(at, tz)
  const weekday = new Date(at + tz * 60_000).getUTCDay()
  return `${t(lang, `day.${weekday}` as MsgKey)} ${clock(at, tz)}`
}

/** The band's limits as plain data, every string in the person's language: what the surface module draws. */
/** What the band gives up, in order, to stay on one row: the estimate's words, the times to reset, then the bars. */
type Fit = { longEstimate: boolean; reset: boolean; bar: number }
const FITS: readonly Fit[] = [
  { longEstimate: true, reset: true, bar: BAR_WIDTH },
  { longEstimate: false, reset: true, bar: BAR_WIDTH },
  { longEstimate: false, reset: false, bar: BAR_WIDTH },
  { longEstimate: false, reset: false, bar: BAR_WIDTH / 2 },
  { longEstimate: false, reset: false, bar: 0 },
]

function viewAt(b: ButtonState, now: number, tz: number, fit: Fit): BandView {
  const lang = b.lang ?? 'en'
  const limit = (label: string, r: WindowReading | null | undefined, color: string, runsOutAt: number | null | undefined): BandLimit[] => {
    if (!r) return []
    const filled = Math.round((Math.min(100, Math.max(0, r.pct)) / 100) * fit.bar)
    const time = typeof runsOutAt === 'number' ? whenText(runsOutAt, now, tz, lang) : null
    const estimate = time === null ? null : t(lang, fit.longEstimate ? 'band.runsOut' : 'band.runsOutShort', { time })
    const reset = fit.reset ? formatDuration(Date.parse(r.resetsAt) - now, lang) : null
    return [{ label, color, pct: r.pct, filled, empty: fit.bar - filled, reset, estimate }]
  }
  return {
    ring: ringGlyph(b.ring),
    share: shareText(b),
    limits: [...limit(t(lang, 'band.5h'), b.five, ACCENT, b.fiveRunsOutAt), ...limit(t(lang, 'band.week'), b.week, WEEK_COLOR, b.weekRunsOutAt)],
  }
}

/** The band's width in cells as the surface module lays it out: the chip in its border, then each limit. */
export function bandWidth(v: BandView): number {
  const chip = 4 + [...v.ring].length + 1 + [...v.share].length
  const limit = (l: BandLimit) => {
    const bar = l.filled + l.empty
    const parts = [l.label, bar > 0 ? '━'.repeat(bar) : null, `${l.pct}%`, l.reset, l.estimate].filter((p): p is string => p !== null)
    return parts.reduce((sum, p) => sum + [...p].length, 0) + parts.length - 1
  }
  return chip + v.limits.reduce((sum, l) => sum + 2 + limit(l), 0)
}

/**
 * The band's limits as plain data, every string in the person's language: what the surface module draws.
 * `columns` is the band's width (0 when unknown): the first fit that stays on one row is drawn.
 */
export function bandView(b: ButtonState, now: number, tz: number, columns = 0): BandView {
  const views = FITS.map(fit => viewAt(b, now, tz, fit))
  const full = views[0] as BandView
  if (columns <= 0) return full
  return views.find(v => bandWidth(v) <= columns) ?? (views.at(-1) as BandView)
}

function isOpenMessage(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { open?: unknown }).open === true
}

/**
 * The band above the prompt: a chip with this chat's share, then both limits with a bar, the percent and
 * the time to reset, each followed by an estimate when it runs out before its reset.
 * A surface module draws it, so a click anywhere on it opens the panel: the desktop draws a Button from
 * its label alone and drops coloured Text inside it. Where the module cannot run, the band is drawn as
 * Text with only the chip's share pressable.
 */
export function usageButton(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const b = await read($, button)
    const now = await $.clock.now()
    const tz = -new Date(now).getTimezoneOffset()
    const view = bandView(b, now, tz, e.props.bodyColumns)
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    if ('Client' in els && !(await read($, bandFailed))) {
      const { Client } = els
      return <Client key={BAND_KEY} module="./band-client.tsx" props={view} flexGrow={1} />
    }
    return (
      <Box flexDirection="row" alignItems="center" flexWrap="nowrap" overflow="hidden" columnGap={2}>
        <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0} borderStyle="round" borderColor={ACCENT} paddingX="xs">
          <Text color={ACCENT}>{view.ring}</Text>
          <Button key={CHIP_KEY} label={view.share} plain onPress={() => openPanel($)} />
        </Box>
        {view.limits.map(l => (
          <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
            <Text dimColor>{l.label}</Text>
            <Box flexDirection="row">
              {l.filled > 0 && (
                <Text mono color={l.color}>
                  {'━'.repeat(l.filled)}
                </Text>
              )}
              {l.empty > 0 && (
                <Text mono dimColor>
                  {'━'.repeat(l.empty)}
                </Text>
              )}
            </Box>
            <Text color="text" bold mono tabular>{`${l.pct}%`}</Text>
            {l.reset !== null && <Text dimColor>{l.reset}</Text>}
            {l.estimate !== null && <Text color="warning">{l.estimate}</Text>}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.message', async ($, e, next) => {
    if (e.element === BAND_KEY && isOpenMessage(e.data)) await openPanel($)
    return next(e)
  })

  // The engine draws the band again after a fault; this time as Text, so it is not left empty.
  on('ui.fault', async ($, e, next) => {
    if (e.element === BAND_KEY) await update($, bandFailed, () => true)
    return next(e)
  })
}
