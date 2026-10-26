import { expect, test } from 'claude-code/testing'

import { bandModuleUsable, saveBandFault } from '../hooks/lib/bandfault'
import { HOME, memDisk } from './memdisk'

const NOW = Date.parse('2026-10-26T06:30:00.000Z')

test('writes down why the band module faulted', async () => {
  const d = memDisk()
  await saveBandFault(d, { at: NOW, phase: 'render', reason: 'boom' })
  expect(JSON.parse(d.files.get(`${HOME}\\.claude\\usagemax\\band-fault.json`)?.text ?? '{}')).toEqual({ at: NOW, phase: 'render', reason: 'boom' })
})

test('gives the band module another try a minute after a fault, instead of falling back for good', () => {
  expect(bandModuleUsable(null, NOW)).toBe(true)
  expect(bandModuleUsable(NOW - 10_000, NOW)).toBe(false)
  expect(bandModuleUsable(NOW - 61_000, NOW)).toBe(true)
})
