import { expect, test } from 'claude-code/testing'

import { MESSAGES, formatDuration, langFromConfig, requestsLabel, t } from '../hooks/lib/i18n'

test('every key exists in ru and en', () => {
  expect(Object.keys(MESSAGES.en).sort()).toEqual(Object.keys(MESSAGES.ru).sort())
  for (const lang of ['ru', 'en'] as const) for (const text of Object.values(MESSAGES[lang])) expect(text.length > 0).toBe(true)
})

test('falls back to Russian', () => {
  expect(langFromConfig('Default (English)')).toBe('ru')
  expect(langFromConfig(undefined)).toBe('ru')
  expect(langFromConfig('Russian')).toBe('ru')
  expect(langFromConfig('русский')).toBe('ru')
  expect(langFromConfig('English')).toBe('en')
})

test('fills parameters', () => {
  expect(t('ru', 'forecast.runsOutAt', { time: '16:40' })).toBe('Окно 5 ч кончится в 16:40')
  expect(t('en', 'reset.in', { time: '2h 10m' })).toBe('resets in 2h 10m')
})

test('counts requests with Russian plural forms', () => {
  expect(requestsLabel(1, 'ru')).toBe('1 запрос')
  expect(requestsLabel(3, 'ru')).toBe('3 запроса')
  expect(requestsLabel(12, 'ru')).toBe('12 запросов')
  expect(requestsLabel(21, 'ru')).toBe('21 запрос')
  expect(requestsLabel(1, 'en')).toBe('1 request')
  expect(requestsLabel(5, 'en')).toBe('5 requests')
})

test('formats durations', () => {
  expect(formatDuration(130 * 60_000, 'ru')).toBe('2 ч 10 мин')
  expect(formatDuration(130 * 60_000, 'en')).toBe('2h 10m')
  expect(formatDuration(3 * 86_400_000 + 5 * 3_600_000, 'ru')).toBe('3 д 5 ч')
  expect(formatDuration(40_000, 'en')).toBe('1m')
})
