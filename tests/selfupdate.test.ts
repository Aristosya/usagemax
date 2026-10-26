import { expect, test } from 'claude-code/testing'

import { gitMarketplace, isNewer, refreshMarketplace } from '../hooks/lib/selfupdate'
import { kit, start } from './kit'
import { HOME, memDisk } from './memdisk'

const CONFIG = `${HOME}\\.claude`
const CLONE = `${CONFIG}\\plugins\\marketplaces\\usagemax`
const KNOWN = `${CONFIG}\\plugins\\known_marketplaces.json`

const known = (source: object) => JSON.stringify({ usagemax: { source, installLocation: CLONE, lastUpdated: '2026-10-26T05:58:40.066Z' } })
const manifest = (version: string) => JSON.stringify({ name: 'usagemax', version })

test('finds the marketplace clone when usagemax came from GitHub', async () => {
  const d = memDisk()
  await d.write(KNOWN, known({ source: 'github', repo: 'Aristosya/usagemax' }))
  expect(await gitMarketplace(d, CONFIG)).toBe(CLONE)
})

test('leaves a marketplace added from a folder alone', async () => {
  const d = memDisk()
  await d.write(KNOWN, known({ source: 'directory', path: 'C:\\projects\\usagemax' }))
  expect(await gitMarketplace(d, CONFIG)).toBeNull()
  expect(await gitMarketplace(memDisk(), CONFIG)).toBeNull()
})

test('pulls the clone to the newest commit and reads the version it now offers', async () => {
  const d = memDisk()
  await d.write(`${CLONE}\\.claude-plugin\\plugin.json`, manifest('0.6.0'))
  expect(await refreshMarketplace(d, CLONE)).toBe('0.6.0')
  expect(d.commands).toEqual([
    ['git', '-C', CLONE, 'fetch', '--depth', '1', 'origin'],
    ['git', '-C', CLONE, 'reset', '--hard', 'FETCH_HEAD'],
  ])
})

test('compares versions part by part', () => {
  expect(isNewer('0.5.10', '0.5.9')).toBe(true)
  expect(isNewer('0.6.0', '0.5.3')).toBe(true)
  expect(isNewer('0.5.3', '0.5.3')).toBe(false)
  expect(isNewer('0.4.9', '0.5.0')).toBe(false)
})

test('tells once that a newer version is out, a few seconds after the chat starts', async ($, on) => {
  const k = kit(on, { language: null })
  await k.disk.write(KNOWN, known({ source: 'github', repo: 'Aristosya/usagemax' }))
  await k.disk.write(`${CLONE}\\.claude-plugin\\plugin.json`, manifest('9.9.9'))
  await start($)
  await k.clock.advance(10_000)
  expect(k.toasts.filter(x => x.includes('9.9.9'))).toEqual(['usagemax 9.9.9 is out: press Update in Settings → Your plugins'])
  expect(k.disk.commands.some(c => c[0] === 'git' && c.includes('fetch'))).toBe(true)
})

test('stays quiet and off the network when settings turn it off', async ($, on) => {
  const k = kit(on)
  await k.disk.write(KNOWN, known({ source: 'github', repo: 'Aristosya/usagemax' }))
  await k.disk.write(`${CLONE}\\.claude-plugin\\plugin.json`, manifest('9.9.9'))
  await k.disk.write(`${HOME}\\.claude\\usagemax\\settings.json`, '{"selfUpdate":false}')
  await start($)
  await k.clock.advance(10_000)
  expect(k.toasts.filter(x => x.includes('9.9.9'))).toEqual([])
  expect(k.disk.commands.filter(c => c[0] === 'git')).toEqual([])
})

test('does not touch a folder marketplace on start', async ($, on) => {
  const k = kit(on)
  await k.disk.write(KNOWN, known({ source: 'directory', path: 'C:\\projects\\usagemax' }))
  await start($)
  await k.clock.advance(10_000)
  expect(k.disk.commands.filter(c => c[0] === 'git')).toEqual([])
})
