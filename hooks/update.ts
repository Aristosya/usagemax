import type { EngineInterface } from 'claude-code'

import { diskOf } from './lib/disk'
import { langOf, t } from './lib/i18n'
import { gitMarketplace, isNewer, refreshMarketplace } from './lib/selfupdate'
import { readSettings } from './lib/settings'
import { VERSION } from './lib/version'

/** How often a chat start may refresh the marketplace from GitHub. */
const CHECK_EVERY_MS = 3_600_000
const CHECKED_KEY = 'updateCheckedAt'
const TOLD_KEY = 'updateToldFor'

/**
 * Refreshes the usagemax marketplace clone so Claude Code's Update button sees a new version, and says once
 * per version that one is out. Off with `"selfUpdate": false`; a marketplace added from a folder is left alone.
 */
export async function checkForUpdate($: EngineInterface): Promise<void> {
  const d = diskOf($)
  if (!(await readSettings(d)).selfUpdate) return
  const now = await $.clock.now()
  const checked = await $.store.get(CHECKED_KEY)
  if (typeof checked === 'number' && now - checked < CHECK_EVERY_MS) return
  await $.store.set(CHECKED_KEY, now)
  const home = await d.home()
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}${home.includes('/') && !home.includes('\\') ? '/' : '\\'}.claude`
  const clone = await gitMarketplace(d, configDir)
  if (clone === null) return
  const latest = await refreshMarketplace(d, clone)
  if (latest === null || !isNewer(latest, VERSION)) return
  if ((await $.store.get(TOLD_KEY)) === latest) return
  await $.store.set(TOLD_KEY, latest)
  $.ui.toast(t(await langOf($), 'toast.update', { version: latest }))
}
