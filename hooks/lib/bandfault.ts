import type { Disk } from './disk'

/** How long the band stays plain text after its surface module faulted, before it tries the module again. */
const RETRY_AFTER_MS = 60_000

export type BandFault = { at: number; phase: string; reason: string }

/** The module again once a minute has passed since its last fault: one fault must not cost the click for good. */
export function bandModuleUsable(failedAt: number | null, now: number): boolean {
  return failedAt === null || now - failedAt >= RETRY_AFTER_MS
}

/** `%USERPROFILE%\.claude\usagemax\band-fault.json`: the last fault, for whoever wonders why the band went plain. */
export async function saveBandFault(d: Disk, fault: BandFault): Promise<void> {
  const home = await d.home()
  const sep = home.includes('\\') || !home.includes('/') ? '\\' : '/'
  await d.write([home, '.claude', 'usagemax', 'band-fault.json'].join(sep), JSON.stringify(fault))
}
