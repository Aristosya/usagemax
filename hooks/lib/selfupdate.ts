import type { Disk } from './disk'

/** The path separator a folder already uses: Windows homes have `\`, others `/`. */
const sepOf = (path: string): string => (path.includes('\\') || !path.includes('/') ? '\\' : '/')

type KnownMarketplace = { source?: { source?: string }; installLocation?: string }

/**
 * Where Claude Code keeps its clone of the usagemax marketplace, when it was added from git (GitHub or a
 * git URL). A marketplace added from a folder is read in place and has nothing to refresh: null.
 */
export async function gitMarketplace(d: Disk, configDir: string): Promise<string | null> {
  const sep = sepOf(configDir)
  try {
    const known = JSON.parse(await d.read([configDir, 'plugins', 'known_marketplaces.json'].join(sep))) as Record<string, KnownMarketplace>
    const entry = known['usagemax']
    const kind = entry?.source?.source
    return (kind === 'github' || kind === 'git') && typeof entry?.installLocation === 'string' ? entry.installLocation : null
  } catch {
    return null
  }
}

/**
 * Brings the clone to the newest commit, as `claude plugin marketplace update` would, and returns the version
 * it now offers. Claude Code's Update button compares against this clone, which it never refreshes for a
 * third-party marketplace unless auto-update is on. Null when git or the manifest fails.
 */
export async function refreshMarketplace(d: Disk, clone: string): Promise<string | null> {
  const fetched = await d.run(['git', '-C', clone, 'fetch', '--depth', '1', 'origin'])
  if (fetched.exitCode !== 0) return null
  const reset = await d.run(['git', '-C', clone, 'reset', '--hard', 'FETCH_HEAD'])
  if (reset.exitCode !== 0) return null
  try {
    const sep = sepOf(clone)
    const manifest = JSON.parse(await d.read([clone, '.claude-plugin', 'plugin.json'].join(sep))) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

/** `0.5.10` is newer than `0.5.9`: dotted numbers compared part by part. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y
  }
  return false
}
