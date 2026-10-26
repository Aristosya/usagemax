import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Forecast, ModelShare, Pace, PanelData, Period, Reading, TopRow, TurnRecord, WindowReading } from '../types'
import { diskOf } from './lib/disk'
import { formatPct5h, formatPctWeek, formatTok, visibleTokens } from './lib/format'
import { type Lang, type MsgKey, formatDuration, langOf, requestsLabel, t } from './lib/i18n'
import { emptySession, loadAll } from './lib/ledger'
import { calibrate } from './lib/percent'
import { readingFrom } from './lib/readings'
import { resolveTitle } from './lib/title'
import { forecast, periodBounds, sessionSummary, shareKey, topChats } from './lib/report'
import { VERSION } from './lib/version'
import { sinceReset } from './lib/account'
import { ofScope, resetScope, scopeOf } from './scope'
import { NBSP, axisCells, dailyCost, heatLevel, hourlyGrid, modelBar, modelName, modelSplit, paceOf, trendGlyph } from './lib/visuals'

export const PANE_ID = 'usagemax'

export const PERIODS: readonly Period[] = ['hour', 'today', 'yesterday', 'window5h', 'week']
export const PERIOD_KEY: Record<Period, MsgKey> = {
  hour: 'period.hour',
  today: 'period.today',
  yesterday: 'period.yesterday',
  window5h: 'period.window5h',
  week: 'period.week',
}
/** Bar lengths in characters, and the theme colours of the 5-hour window, the week and «Прочее». */
const BAR_WIDTH = 32
const TOP_BAR_WIDTH = 24
const COLOR_5H = 'claude'
const COLOR_WEEK = 'permission'
const COLOR_OTHER = 'inactive'
const COLOR_TIME = 'inactive'
/** What is left of a limit, beside the used part in the 5-hour colour. */
const COLOR_LEFT = 'success'
/** Heatmap levels 0-3: idle and low in the neutral colour, busy in the 5-hour colour; 0 and 2 are drawn dim. */
const HEAT_COLORS = ['inactive', 'inactive', 'claude', 'claude'] as const
const DAY_KEY: readonly MsgKey[] = ['day.0', 'day.1', 'day.2', 'day.3', 'day.4', 'day.5', 'day.6']
const MODEL_BAR_WIDTH = 32

function modelColor(model: string): string {
  if (/opus/i.test(model)) return 'claude'
  if (/sonnet/i.test(model)) return 'permission'
  if (/haiku/i.test(model)) return 'success'
  if (/fable|mythos/i.test(model)) return 'warning'
  return 'inactive'
}

/** The model bar: one coloured run per model, widths adding up to the bar's width. */
function modelSegments(models: readonly ModelShare[]): { color: string; width: number }[] {
  const widths = modelBar(models, MODEL_BAR_WIDTH)
  return models.map((m, i) => ({ color: modelColor(m.model), width: widths[i] ?? 0 })).filter(s => s.width > 0)
}

/** Files read for the panel: the week plus a day of slack around its reset. */
const LOOKBACK_MS = 8 * 86_400_000
const WEEK_MS = 7 * 86_400_000

const panel = atom({ plugin: 'usagemax', key: 'panel' } as const, null as PanelData | null)
const period = atom({ plugin: 'usagemax', key: 'period' } as const, 'today' as Period)
/** The reset button's first press: the second one resets. */
const resetArmed = atom({ plugin: 'usagemax', key: 'resetArmed' } as const, false)

const share5 = (v: number): string => formatPct5h(v).replace('+', '')
const shareWeek = (v: number): string => formatPctWeek(v).replace('+', '')
const pad = (n: number): string => String(n).padStart(2, '0')

export function clock(at: number, tzOffsetMin: number): string {
  const d = new Date(at + tzOffsetMin * 60_000)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** A recorded request as shown: rows saved from engine messages before their cleanup get a label. */
export function shownPrompt(prompt: string, lang: Lang): string {
  if (prompt.startsWith('<cross-session-message')) return t(lang, 'prompt.crossSession')
  if (prompt.startsWith('<task-notification')) return t(lang, 'prompt.taskNotification')
  return prompt
}

export function requestLine(x: TurnRecord, tz: number, lang: Lang): string {
  const five = x.pct.five_hour ? share5(x.pct.five_hour.v) : '–'
  const week = x.pct.seven_day ? shareWeek(x.pct.seven_day.v) : '–'
  const tok = formatTok(visibleTokens(x.tokens) + visibleTokens(x.agents.tokens))
  return `${clock(x.endedAt, tz)}  ${five}  ${week}  ${tok} Tok  ${shownPrompt(x.prompt, lang)}`
}

function forecastLine(f: Forecast, lang: Lang, tz: number): string {
  if (f.kind === 'runsOutAt') return t(lang, 'forecast.runsOutAt', { time: clock(f.at, tz) })
  return t(lang, f.kind === 'lasts' ? 'forecast.lasts' : 'forecast.unknown')
}

/** A top row's share in the period's own window: `–` while that window's rate is not ready. */
export function rowShare(r: TopRow, p: Period): string {
  if (shareKey(p) === 'pctWeek') return r.unknown?.seven_day ? '–' : shareWeek(r.pctWeek)
  return r.unknown?.five_hour ? '–' : share5(r.pct5h)
}

export function rowLines(r: TopRow, i: number, p: Period, lang: Lang): [string, string | null] {
  const tok = r.id === 'other' ? '' : `  ${formatTok(r.tokens)} Tok`
  const heavy = r.heaviest
    ? `    ${shareKey(p) === 'pctWeek' ? shareWeek(r.heaviest.pctWeek) : share5(r.heaviest.pct5h)}  ${shownPrompt(r.heaviest.prompt, lang)}`
    : null
  const main = rowShare(r, p)
  return [`${i + 1}. ${r.title}  ${main}${tok}`, heavy]
}

/** Titles re-read for other chats, by session id: each costs a PowerShell run on a large transcript. */
const healed = new Map<string, string>()

/**
 * A title another chat saved while its mod still read transcripts in the console code page: Cyrillic
 * came back as `?`. Two or more `?` and no Cyrillic letter; a real question keeps its letters.
 */
function looksBroken(title: string): boolean {
  return (title.match(/\?/g)?.length ?? 0) >= 2 && !/[Ѐ-ӿ]/.test(title)
}

/** What the panel and the reports show, from every chat's file. */
export async function computePanel($: EngineInterface): Promise<PanelData> {
  const now = await $.clock.now()
  const sessionId = await $.session.id()
  const scope = await scopeOf($)
  // This account's chats: every request for the rate and the limits, only those after a reset on show.
  const all = ofScope(await loadAll(diskOf($), { since: now - LOOKBACK_MS }), scope)
  for (const f of all) {
    if (f.sessionId === sessionId || !looksBroken(f.title)) continue
    let title = healed.get(f.sessionId)
    if (title === undefined) {
      title = await resolveTitle(diskOf($), f.cwd, f.sessionId, f.turns[0]?.prompt ?? f.title)
      healed.set(f.sessionId, title)
    }
    f.title = title
  }
  const files = all.map(f => sinceReset(f, scope.resetAt))
  const own = files.find(f => f.sessionId === sessionId) ?? emptySession(sessionId, await $.session.cwd(), now)
  // `$.session.usage()` answers this chat's last response; another chat may have read the windows later.
  const ownReading = readingFrom(await $.session.usage(), now)
  const latest = all
    .flatMap(f => f.turns.map(x => x.readings.after))
    .filter((r): r is Reading => r !== null && r.at <= now && r.five_hour !== undefined)
    .sort((a, b) => b.at - a.at)[0]
  const current = latest ?? ownReading
  const lang = await langOf($)
  const tz = -new Date(now).getTimezoneOffset()
  const other = t(lang, 'other.title')
  const top = {} as Record<Period, TopRow[]>
  // One account rate for every chat: the shares chats saved for themselves are not trusted.
  const rate = calibrate(all.flatMap(f => f.turns), now)
  const models = {} as Record<Period, ModelShare[]>
  for (const p of PERIODS) {
    const period = periodBounds(p, now, tz, current)
    // After a reset a period starts there: the usage before it must not resurface as «Other».
    const bounds = scope.resetAt !== null && period.from < scope.resetAt ? { ...period, from: scope.resetAt } : period
    top[p] = topChats(files, p, bounds, other, rate)
    models[p] = modelSplit(files, bounds)
  }
  const days = dailyCost(files, now, tz)
  const maxDay = Math.max(0, ...days.map(d => d.units))
  const readings = all.flatMap(f => f.turns.flatMap(x => [x.readings.before, x.readings.after])).filter((r): r is Reading => r !== null)
  const data: PanelData = {
    lang,
    title: own.title,
    session: sessionSummary(own, current, rate),
    windows: current,
    forecast: forecast([...readings, current], now),
    top,
    tzOffsetMin: tz,
    at: now,
    rate,
    pace: current.five_hour ? paceOf(current.five_hour, now) : null,
    weekPace: current.seven_day ? paceOf(current.seven_day, now, WEEK_MS) : null,
    trend: { days, peakWeek: rate.seven_day === null || maxDay === 0 ? null : maxDay * rate.seven_day },
    heat: hourlyGrid(files, now, tz),
    models,
    account: scope.email,
    since: scope.resetAt,
  }
  return data
}

/** `26.10 06:30` in the viewer's zone: when the statistics start after a reset. */
function stamp(at: number, tz: number): string {
  const d = new Date(at + tz * 60_000)
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)} ${clock(at, tz)}`
}

/** The reset's second press: this account's statistics start over now; the rate is kept. */
export async function confirmReset($: EngineInterface): Promise<void> {
  await resetScope($, await $.clock.now())
  await update($, resetArmed, () => false)
  await refreshPanel($)
}

/** Recomputes the panel; called on open and after each turn once it was opened. */
export async function refreshPanel($: EngineInterface): Promise<void> {
  const data = await computePanel($)
  await update($, panel, () => data)
}

export async function isPanelReady($: EngineInterface): Promise<boolean> {
  return (await read($, panel)) !== null
}

export async function openPanel($: EngineInterface): Promise<void> {
  await refreshPanel($)
  await $.ui.open({ id: PANE_ID, title: t((await read($, panel))?.lang ?? 'en', 'panel.title') })
}

export function usagePanel(on: On): void {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const data = await read($, panel)
    const chosen = await read($, period)
    const armed = await read($, resetArmed)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (!data) {
      const lang = await langOf($)
      return (
        <Box flexDirection="column">
          <Text dimColor>{t(lang, 'panel.empty')}</Text>
        </Box>
      )
    }
    const { lang, session, windows, tzOffsetMin: tz } = data
    const rows = data.top[chosen]
    const key = shareKey(chosen)
    const trendMax = Math.max(0, ...data.trend.days.map(d => d.units))
    const heatMax = Math.max(0, ...data.heat.flat())
    const { rate } = data
    const turnShare = (x: TurnRecord): string => (rate.five_hour === null ? '–' : formatPct5h(x.units * rate.five_hour))
    const topMax = Math.max(0.0001, ...rows.map(r => r[key]))
    const five = windows?.five_hour
    const resetIn = (resetsAt: string) => t(lang, 'reset.in', { time: formatDuration(Date.parse(resetsAt) - data.at, lang) })

    // The desktop draws no Svg here and sizes boxes its own way: bars are coloured line characters.
    const Bar = (pct: number, color: string, width = BAR_WIDTH, rest?: string) => {
      const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
      return (
        <Box flexDirection="row">
          {filled > 0 && (
            <Text mono color={color}>
              {'━'.repeat(filled)}
            </Text>
          )}
          {filled < width && (
            <Text mono color={rest} dimColor={rest === undefined}>
              {'━'.repeat(width - filled)}
            </Text>
          )}
        </Box>
      )
    }
    const Row = (left: JSX.Element, right: JSX.Element) => (
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        {left}
        {right}
      </Box>
    )
    const Cap = (text: string) => (
      <Text size="caption" bold dimColor>
        {text.toUpperCase()}
      </Text>
    )
    /** One limit's pace: used in orange and what is left in green, then the time that passed. */
    const PaceBlock = (title: MsgKey, pace: Pace) => (
      <Box flexDirection="column">
        {Cap(t(lang, title))}
        {Row(
          <Text>{t(lang, 'pace.used')}</Text>,
          <Box flexDirection="row" gap={1}>
            <Text mono tabular color={COLOR_5H}>{`${pace.used}%`}</Text>
            <Text dimColor>/</Text>
            <Text mono tabular color={COLOR_LEFT}>{t(lang, 'panel.left', { pct: Math.max(0, 100 - pace.used) })}</Text>
          </Box>,
        )}
        {Bar(pace.used, COLOR_5H, BAR_WIDTH, COLOR_LEFT)}
        {Row(<Text>{t(lang, 'pace.elapsed')}</Text>, <Text mono tabular>{`${pace.elapsed}%`}</Text>)}
        {Bar(pace.elapsed, COLOR_TIME)}
        <Text size="caption" color={pace.verdict === 'faster' ? 'warning' : undefined} dimColor={pace.verdict !== 'faster'}>
          {t(lang, `pace.${pace.verdict}`)}
        </Text>
      </Box>
    )
    const Limit = (label: string, r: WindowReading | undefined, color: string) =>
      r && (
        <Box flexDirection="column" marginTop={1}>
          {Row(<Text>{label}</Text>, <Text mono tabular>{t(lang, 'panel.left', { pct: Math.max(0, 100 - r.pct) })}</Text>)}
          {Bar(r.pct, color)}
          <Text size="caption" dimColor>
            {resetIn(r.resetsAt)}
          </Text>
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1}>
        {Row(
          <Text bold>{t(lang, 'panel.title')}</Text>,
          <Box flexDirection="row" gap={1}>
            {PERIODS.map(p => (
              <Button key={`period-${p}`} label={t(lang, PERIOD_KEY[p])} variant={p === chosen ? 'primary' : 'secondary'} onPress={() => update($, period, () => p)} />
            ))}
          </Box>,
        )}
        {(data.account !== null || data.since !== null) && (
          <Text size="caption" dimColor>
            {[data.account, data.since === null ? null : t(lang, 'panel.since', { time: stamp(data.since, tz) })].filter(x => x !== null).join(' · ')}
          </Text>
        )}

        <Box flexDirection="column">
          {Cap(t(lang, 'window.5h'))}
          {five ? (
            <Box flexDirection="column">
              <Text size="title" weight="bold" mono tabular>{`${five.pct}%`}</Text>
              <Text dimColor>{`${resetIn(five.resetsAt)} · ${forecastLine(data.forecast, lang, tz)}`}</Text>
            </Box>
          ) : (
            <Text dimColor>{t(lang, 'panel.empty')}</Text>
          )}
        </Box>

        {data.pace && PaceBlock('panel.pace5h', data.pace)}
        {data.weekPace && PaceBlock('panel.paceWeek', data.weekPace)}

        <Box flexDirection="column">
          {Cap(t(lang, 'panel.windows'))}
          {Limit(t(lang, 'window.5h'), five, COLOR_5H)}
          {Limit(t(lang, 'window.week'), windows?.seven_day, COLOR_WEEK)}
        </Box>

        <Box flexDirection="column">
          {Row(
            Cap(t(lang, 'panel.trend')),
            <Text size="caption" dimColor>
              {t(lang, 'panel.peak', { pct: data.trend.peakWeek === null ? '–' : shareWeek(data.trend.peakWeek) })}
            </Text>,
          )}
          <Box flexDirection="row" gap={1}>
            {data.trend.days.map(d => (
              <Box key={`trend-${d.start}`} flexDirection="column" alignItems="center">
                <Text size="heading" color={COLOR_WEEK}>
                  {trendGlyph(d.units, trendMax)}
                </Text>
                <Text size="caption" dimColor>
                  {t(lang, DAY_KEY[d.weekday] ?? 'day.0')}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>

        <Box flexDirection="column">
          {Cap(t(lang, 'panel.activity'))}
          {data.heat.map((hours, row) => (
            <Box key={`heat-row-${row}`} flexDirection="row">
              <Text mono dimColor>{`${t(lang, DAY_KEY[data.trend.days[row]?.weekday ?? 0] ?? 'day.0')}${NBSP}`}</Text>
              {hours.map(units => {
                const level = heatLevel(units, heatMax)
                return (
                  <Text mono color={HEAT_COLORS[level]} dimColor={level === 0 || level === 2}>
                    █
                  </Text>
                )
              })}
            </Box>
          ))}
          <Box key="heat-axis" flexDirection="row">
            <Text mono dimColor>{NBSP.repeat(3)}</Text>
            {axisCells().map(c => (
              <Text mono dimColor>
                {c}
              </Text>
            ))}
          </Box>
        </Box>

        <Box flexDirection="column">
          {Row(Cap(t(lang, 'panel.session')), <Text size="caption" dimColor>{requestsLabel(session.count, lang)}</Text>)}
          {session.count === 0 ? (
            <Text dimColor>{t(lang, 'panel.noRequests')}</Text>
          ) : (
            <Box flexDirection="column">
              {Row(
                <Text bold wrap="truncate-end">{data.title === '' ? t(lang, 'panel.session') : data.title}</Text>,
                <Text mono tabular>{t(lang, 'panel.ofWindow', { pct: session.unknown?.five_hour ? '–' : share5(session.pct5h) })}</Text>,
              )}
              {Bar(five && five.pct > 0 ? (session.pct5h / five.pct) * 100 : 0, COLOR_5H)}
              <Text size="caption" dimColor wrap="truncate-end">
                {session.heaviest
                  ? t(lang, 'panel.heaviestLine', {
                      tok: formatTok(session.tokens),
                      prompt: shownPrompt(session.heaviest.prompt, lang),
                      pct: turnShare(session.heaviest).replace('+', ''),
                    })
                  : `${formatTok(session.tokens)} Tok`}
              </Text>
            </Box>
          )}
        </Box>

        {data.models[chosen].length > 0 && (
          <Box flexDirection="column">
            {Cap(t(lang, 'panel.models', { period: t(lang, PERIOD_KEY[chosen]) }))}
            <Box flexDirection="row">
              {modelSegments(data.models[chosen]).map(s => (
                <Text mono color={s.color}>
                  {'━'.repeat(s.width)}
                </Text>
              ))}
            </Box>
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              {data.models[chosen].map(m => (
                <Box key={`model-${m.model}`} flexDirection="row" gap={1}>
                  <Text color={modelColor(m.model)}>●</Text>
                  <Text size="caption" dimColor>{`${modelName(m.model)} ${Math.round(m.share * 100)}%`}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Box flexDirection="column">
          {Row(Cap(t(lang, 'panel.topOf', { period: t(lang, PERIOD_KEY[chosen]) })), Cap(t(lang, key === 'pctWeek' ? 'panel.colWeek' : 'panel.col5h')))}
          {rows.length === 0 && <Text dimColor>{t(lang, 'report.none')}</Text>}
          {rows.map(r => {
            const isOther = r.id === 'other'
            return (
              <Box flexDirection="column" marginTop={1}>
                {Row(
                  <Text dimColor={isOther} wrap="truncate-end">{r.title}</Text>,
                  <Text mono tabular dimColor={isOther}>{rowShare(r, chosen)}</Text>,
                )}
                {Bar((r[key] / topMax) * 100, isOther ? COLOR_OTHER : key === 'pctWeek' ? COLOR_WEEK : COLOR_5H, TOP_BAR_WIDTH)}
                {r.heaviest && (
                  <Text size="caption" dimColor wrap="truncate-end">
                    {shownPrompt(r.heaviest.prompt, lang)}
                  </Text>
                )}
              </Box>
            )
          })}
        </Box>

        {session.last.length > 0 && (
          <Box flexDirection="column">
            {Cap(t(lang, 'panel.last'))}
            {session.last.map(x =>
              Row(
                <Text dimColor wrap="truncate-end">{`${clock(x.endedAt, tz)}  ${shownPrompt(x.prompt, lang)}`}</Text>,
                <Text mono tabular dimColor>{`${turnShare(x)} · ${formatTok(visibleTokens(x.tokens) + visibleTokens(x.agents.tokens))}`}</Text>,
              ),
            )}
          </Box>
        )}

        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
          <Text size="caption" dimColor>{`usagemax ${VERSION}`}</Text>
          {armed ? (
            <Box flexDirection="row" gap={1}>
              <Button key="usagemax-reset-confirm" label={t(lang, 'panel.resetConfirm')} variant="primary" onPress={() => confirmReset($)} />
              <Button key="usagemax-reset-cancel" label={t(lang, 'panel.resetCancel')} onPress={() => update($, resetArmed, () => false)} />
            </Box>
          ) : (
            <Button key="usagemax-reset" label={t(lang, 'panel.reset')} onPress={() => update($, resetArmed, () => true)} />
          )}
        </Box>
      </Box>
    )
  })
}
