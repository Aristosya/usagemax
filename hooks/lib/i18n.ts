import type { EngineInterface } from 'claude-code'

export type Lang = 'ru' | 'en'

const RU = {
  'panel.title': 'Расход лимитов',
  'panel.session': 'Этот чат',
  'panel.windows': 'Лимиты',
  'panel.forecast': 'Прогноз',
  'panel.top': 'Топ чатов',
  'panel.last': 'Последние запросы',
  'panel.heaviest': 'Самый тяжёлый',
  'panel.empty': 'Пока нет данных',
  'panel.noRequests': 'В этом чате пока нет запросов',
  'prompt.crossSession': 'Сообщение из другой сессии',
  'prompt.taskNotification': 'Уведомление о фоновой задаче',
  'panel.left': '{pct}% осталось',
  'panel.pace': 'Темп',
  'pace.used': 'Занято',
  'pace.elapsed': 'Прошло времени',
  'pace.faster': 'идёшь быстрее нормы',
  'pace.slower': 'идёшь медленнее нормы',
  'pace.onPace': 'идёшь в норме',
  'panel.trend': 'Тренд · 7 дней',
  'panel.peak': 'пик {pct}',
  'panel.activity': 'Активность · часы',
  'panel.models': 'Модели · {period}',
  'day.0': 'Вс',
  'day.1': 'Пн',
  'day.2': 'Вт',
  'day.3': 'Ср',
  'day.4': 'Чт',
  'day.5': 'Пт',
  'day.6': 'Сб',
  'panel.ofWindow': '{pct} окна',
  'panel.heaviestLine': '{tok} Tok · самый тяжёлый: {prompt} — {pct}',
  'panel.topOf': 'Топ чатов · {period}',
  'panel.col5h': '% окна 5 ч',
  'panel.colWeek': '% недели',
  'requests.one': '{n} запрос',
  'requests.few': '{n} запроса',
  'requests.many': '{n} запросов',
  'panel.sessionLine': 'Окно 5 ч {five} · неделя {week} · {tok} Tok',
  'window.5h': 'Окно 5 ч',
  'window.week': 'Неделя',
  'period.hour': 'Час',
  'period.today': 'Сегодня',
  'period.yesterday': 'Вчера',
  'period.window5h': 'Окно 5 ч',
  'period.week': 'Неделя',
  'other.title': 'Прочее (Chat, другие устройства)',
  'forecast.runsOutAt': 'Окно 5 ч кончится в {time}',
  'forecast.lasts': 'До сброса хватит',
  'forecast.unknown': 'Мало данных для прогноза',
  'reset.in': 'сброс через {time}',
  'toast.5h80': 'Окно 5 ч занято на 80%',
  'toast.5h90': 'Окно 5 ч занято на 90%',
  'toast.wk80': 'Недельный лимит занят на 80%',
  'toast.runout': 'При таком темпе окно 5 ч кончится в {time}, раньше сброса',
  'toast.hungry': 'Чат «{title}» за час съел {pct} окна 5 ч',
  'cmd.description': 'Расход лимитов: панель и отчёты',
  'cmd.help': 'Команды: /usagemax — панель; /usagemax top [hour|today|yesterday|5h|week] — топ чатов; /usagemax chat — запросы этого чата; /usagemax hour — топ за час',
  'report.top': 'Топ чатов: {period}',
  'report.chat': 'Запросы этого чата',
  'report.none': 'За этот период запросов нет',
  'band.5h': '5 ч',
  'band.week': 'неделя',
  'band.runsOut': '▲ кончится ≈{time}',
  'band.runsOutShort': '▲ ≈{time}',
  'duration.dh': '{d} д {h} ч',
  'duration.hm': '{h} ч {m} мин',
  'duration.m': '{m} мин',
} as const

export type MsgKey = keyof typeof RU

const EN: Record<MsgKey, string> = {
  'panel.title': 'Usage limits',
  'panel.session': 'This chat',
  'panel.windows': 'Limits',
  'panel.forecast': 'Forecast',
  'panel.top': 'Top chats',
  'panel.last': 'Last requests',
  'panel.heaviest': 'Heaviest',
  'panel.empty': 'No data yet',
  'panel.noRequests': 'No requests in this chat yet',
  'prompt.crossSession': 'Message from another session',
  'prompt.taskNotification': 'Background task notification',
  'panel.left': '{pct}% left',
  'panel.pace': 'Pace',
  'pace.used': 'Used',
  'pace.elapsed': 'Time passed',
  'pace.faster': 'ahead of the clock',
  'pace.slower': 'behind the clock',
  'pace.onPace': 'on pace',
  'panel.trend': 'Trend · 7 days',
  'panel.peak': 'peak {pct}',
  'panel.activity': 'Activity · hours',
  'panel.models': 'Models · {period}',
  'day.0': 'Su',
  'day.1': 'Mo',
  'day.2': 'Tu',
  'day.3': 'We',
  'day.4': 'Th',
  'day.5': 'Fr',
  'day.6': 'Sa',
  'panel.ofWindow': '{pct} of the window',
  'panel.heaviestLine': '{tok} Tok · heaviest: {prompt} ({pct})',
  'panel.topOf': 'Top chats · {period}',
  'panel.col5h': '% of the 5h window',
  'panel.colWeek': '% of the week',
  'requests.one': '{n} request',
  'requests.few': '{n} requests',
  'requests.many': '{n} requests',
  'panel.sessionLine': '5h window {five} · week {week} · {tok} Tok',
  'window.5h': '5-hour window',
  'window.week': 'Week',
  'period.hour': 'Hour',
  'period.today': 'Today',
  'period.yesterday': 'Yesterday',
  'period.window5h': '5h window',
  'period.week': 'Week',
  'other.title': 'Other (Chat, other devices)',
  'forecast.runsOutAt': '5-hour window runs out at {time}',
  'forecast.lasts': 'Lasts until the reset',
  'forecast.unknown': 'Not enough data yet',
  'reset.in': 'resets in {time}',
  'toast.5h80': '5-hour window is 80% used',
  'toast.5h90': '5-hour window is 90% used',
  'toast.wk80': 'Weekly limit is 80% used',
  'toast.runout': 'At this pace the 5-hour window runs out at {time}, before it resets',
  'toast.hungry': 'Chat «{title}» used {pct} of the 5-hour window in an hour',
  'cmd.description': 'Usage limits: panel and reports',
  'cmd.help': 'Commands: /usagemax opens the panel; /usagemax top [hour|today|yesterday|5h|week] lists chats; /usagemax chat lists this chat; /usagemax hour lists the last hour',
  'report.top': 'Top chats: {period}',
  'report.chat': "This chat's requests",
  'report.none': 'No requests in this period',
  'band.5h': '5h',
  'band.week': 'week',
  'band.runsOut': '▲ runs out ≈{time}',
  'band.runsOutShort': '▲ ≈{time}',
  'duration.dh': '{d}d {h}h',
  'duration.hm': '{h}h {m}m',
  'duration.m': '{m}m',
}

export const MESSAGES: Record<Lang, Record<MsgKey, string>> = { ru: RU, en: EN }

export function t(lang: Lang, key: MsgKey, params: Readonly<Record<string, string | number>> = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all))
}

/** Claude Code's `language` setting; unset ("Default (…)") means Russian, the owner's language. */
export function langFromConfig(value: unknown): Lang {
  const text = typeof value === 'string' ? value : ''
  if (/russian|рус/i.test(text) || /default/i.test(text)) return 'ru'
  return /english/i.test(text) ? 'en' : 'ru'
}

/** `1 запрос`, `3 запроса`, `12 запросов`; English has one and many. */
export function requestsLabel(n: number, lang: Lang): string {
  const tens = n % 100
  const ones = n % 10
  const form = lang === 'en' ? (n === 1 ? 'one' : 'many') : tens >= 11 && tens <= 14 ? 'many' : ones === 1 ? 'one' : ones >= 2 && ones <= 4 ? 'few' : 'many'
  return t(lang, `requests.${form}`, { n })
}

export function formatDuration(ms: number, lang: Lang): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return t(lang, 'duration.dh', { d, h })
  if (h > 0) return t(lang, 'duration.hm', { h, m })
  return t(lang, 'duration.m', { m })
}

export async function langOf($: EngineInterface): Promise<Lang> {
  try {
    return langFromConfig((await $.config.list()).find(row => row.key === 'language')?.value)
  } catch {
    return 'ru'
  }
}
