export type WindowKind = 'five_hour' | 'seven_day'

/** One rate-limit window as a reading saw it: percent used (whole points on 2.1.304) and its reset time. */
export type WindowReading = { pct: number; resetsAt: string }

/** The limit windows at one moment; a window the account does not have is absent. */
export type Reading = { at: number; five_hour?: WindowReading; seven_day?: WindowReading }

export type Tokens = { in: number; out: number; cacheRead: number; cacheWrite: number }

export type PctMode = 'exact' | 'estimate' | 'raw'
export type PctValue = { v: number; mode: PctMode }
export type TurnPct = { five_hour: PctValue | null; seven_day: PctValue | null }

export type TurnReason = 'answer' | 'aborted' | 'refusal' | 'error'

export type TurnRecord = {
  turnId: string
  startedAt: number
  endedAt: number
  prompt: string
  model: string
  tokens: Tokens
  agents: { tokens: Tokens; count: number }
  units: number
  readings: { before: Reading | null; after: Reading | null }
  pct: TurnPct
  isParallel: boolean
  reason: TurnReason
  /** The Claude account the request ran under; absent in requests recorded before 0.5.8. */
  account?: string
}

export type SessionFile = {
  v: 1
  sessionId: string
  title: string
  cwd: string
  startedAt: number
  openTurn: { turnId: string; startedAt: number } | null
  /** Which turn started each background agent, by agent id. */
  agentTurns: Record<string, string>
  turns: TurnRecord[]
}

/** Percent of a window per cost unit; null until enough solo turns were seen. */
export type Rate = { five_hour: number | null; seven_day: number | null }

export type Severity = 'normal' | 'warn' | 'alert'

export type FooterView = { text: string; ring: number | null; severity: Severity }

/** How the line reaches the answer: the turn's own text (drawn on 2.1.304), a drawn row, or a line inside the Markdown. */
export type FooterMode = 'text' | 'tree' | 'rewrite'

export type Period = 'hour' | 'today' | 'yesterday' | 'window5h' | 'week'
export type Bounds = { from: number; to: number }

export type TopRow = {
  id: string
  title: string
  pct5h: number
  pctWeek: number
  tokens: number
  heaviest: { prompt: string; pct5h: number; pctWeek: number; at: number } | null
  /** Windows whose share cannot be told yet (the Other row before calibration); printed as `–`. */
  unknown?: { five_hour?: true; seven_day?: true }
}

/** This chat in the current 5-hour window: share, requests, tokens, the last 10 requests and the heaviest one. */
export type SessionSummary = {
  pct5h: number
  pctWeek: number
  count: number
  tokens: number
  last: TurnRecord[]
  heaviest: TurnRecord | null
  /** Windows whose rate is not ready yet; their shares print as `–`. */
  unknown?: { five_hour?: true; seven_day?: true }
}

export type Forecast = { kind: 'runsOutAt'; at: number } | { kind: 'lasts' } | { kind: 'unknown' }

/** Cost of one local day; `weekday` 0 is Sunday. */
export type DayCost = { start: number; weekday: number; units: number }
export type ModelShare = { model: string; units: number; share: number }
/** How full the 5-hour window is against how much of its time passed, in percent. */
export type Pace = { used: number; elapsed: number; verdict: 'faster' | 'slower' | 'onPace' }

/** Everything the panel draws, computed outside the drawing. */
export type PanelData = {
  lang: 'ru' | 'en'
  title: string
  session: SessionSummary
  windows: Reading | null
  forecast: Forecast
  top: Record<Period, TopRow[]>
  tzOffsetMin: number
  at: number
  /** The account rate the shares were computed with. */
  rate: Rate
  pace: Pace | null
  /** The last 7 local days, today last, and the busiest day's weekly share. */
  trend: { days: DayCost[]; peakWeek: number | null }
  /** Cost per local hour: 7 rows of 24, oldest day first. */
  heat: number[][]
  models: Record<Period, ModelShare[]>
  /** The account's email, when the login names one. */
  account: string | null
  /** When this account last reset its statistics. */
  since: number | null
}

/** What the band above the prompt draws; the windows, forecast and language arrive with the first write. */
export type ButtonState = {
  ring: number | null
  sessionPct: number | null
  five?: WindowReading | null
  week?: WindowReading | null
  fiveRunsOutAt?: number | null
  weekRunsOutAt?: number | null
  lang?: 'ru' | 'en'
}

/** One limit as the band's surface module draws it: every string already in the person's language. */
export type BandLimit = { label: string; color: string; pct: number; filled: number; empty: number; reset: string | null; estimate: string | null }

/** The props of the band's surface module: plain data, as a `Client` takes it. */
export type BandView = { ring: string; share: string; limits: BandLimit[] }

/** A footer waiting for the answer block that ends with `tail`. */
export type FooterEntry = { tail: string; view: FooterView }

declare module 'claude-code' {
  interface PluginState {
    usagemax: {
      footers: FooterEntry[]
      footerMode: FooterMode
      button: ButtonState
      bandFailedAt: number | null
      panel: PanelData | null
      period: Period
      resetArmed: boolean
    }
  }
}
