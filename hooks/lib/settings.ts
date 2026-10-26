import type { FooterMode } from '../../types'
import type { Disk } from './disk'

export type Settings = { footer: FooterMode; selfUpdate: boolean }

const DEFAULTS: Settings = { footer: 'text', selfUpdate: true }

export async function settingsPath(d: Disk): Promise<string> {
  return `${await d.home()}\\.claude\\usagemax\\settings.json`
}

/** `%USERPROFILE%\.claude\usagemax\settings.json`; a missing or broken file gives the defaults. */
export async function readSettings(d: Disk): Promise<Settings> {
  try {
    const raw = JSON.parse(await d.read(await settingsPath(d))) as Partial<Settings>
    const footer = raw.footer === 'tree' || raw.footer === 'rewrite' || raw.footer === 'text' ? raw.footer : DEFAULTS.footer
    return { footer, selfUpdate: raw.selfUpdate !== false }
  } catch {
    return DEFAULTS
  }
}
