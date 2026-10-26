import { expect, test } from 'claude-code/testing'

import { footerText, formatPct5h, formatPctWeek, formatTok, severity, visibleTokens } from '../hooks/lib/format'

test('formats the 5h share', () => {
  expect(formatPct5h(0.34)).toBe('+0.3%')
  expect(formatPct5h(2.4)).toBe('+2.4%')
  expect(formatPct5h(0.04)).toBe('<0.1%')
  expect(formatPct5h(0)).toBe('<0.1%')
})

test('formats the weekly share', () => {
  expect(formatPctWeek(0.012)).toBe('+0.01%')
  expect(formatPctWeek(0.18)).toBe('+0.18%')
  expect(formatPctWeek(0.004)).toBe('<0.01%')
})

test('formats tokens', () => {
  expect(formatTok(850)).toBe('850')
  expect(formatTok(9_400)).toBe('9K')
  expect(formatTok(140_200)).toBe('140K')
  expect(formatTok(1_230_000)).toBe('1.2M')
})

test('counts visible tokens without cache reads', () => {
  expect(visibleTokens({ in: 1000, out: 3000, cacheRead: 900_000, cacheWrite: 5000 })).toBe(9000)
})

test('builds the footer', () => {
  expect(footerText({ pct5h: 0.3, pctWeek: 0.01, tok: 9000 })).toBe('Used: +0.3%/+0.01% 9K Tok')
  expect(footerText({ pct5h: null, pctWeek: null, tok: 9000 })).toBe('Used: 9K Tok')
  expect(footerText({ pct5h: 1.2, pctWeek: null, tok: 9000 })).toBe('Used: +1.2%/– 9K Tok')
  expect(footerText({ pct5h: null, pctWeek: 0.02, tok: 9000 })).toBe('Used: –/+0.02% 9K Tok')
  expect(footerText({ pct5h: 0.37, pctWeek: 0.1, tok: 22_000, cached: 9_800_000 })).toBe('Used: +0.4%/+0.10% 22K Tok · 9.8M cached')
  expect(footerText({ pct5h: null, pctWeek: null, tok: 9000, cached: 0 })).toBe('Used: 9K Tok')
})

test('colours from 3% and 6%', () => {
  expect(severity(2.9)).toBe('normal')
  expect(severity(3)).toBe('warn')
  expect(severity(6)).toBe('alert')
  expect(severity(null)).toBe('normal')
})
