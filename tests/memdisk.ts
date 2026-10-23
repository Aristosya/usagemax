import type { Disk } from '../hooks/lib/disk'

export const HOME = 'C:\\Users\\u'
export const SESSIONS = `${HOME}\\.claude\\usagemax\\sessions`

export type MemDisk = Disk & {
  files: Map<string, { text: string; mtimeMs: number }>
  reads: string[]
  commands: string[][]
  /** The time new writes are stamped with. */
  now: { ms: number }
}

const parent = (path: string): string => path.slice(0, path.lastIndexOf('\\'))
const base = (path: string): string => path.slice(path.lastIndexOf('\\') + 1)

/** An in-memory Windows disk under C:\Users\u; `cmd /c del` deletes, any other command prints `stdout`. */
export function memDisk(now = 1_000_000, stdout = ''): MemDisk {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const d: MemDisk = {
    files,
    reads: [],
    commands: [],
    now: { ms: now },
    home: async () => HOME,
    read: async path => {
      d.reads.push(path)
      const file = files.get(path)
      if (file === undefined) throw new Error(`ENOENT: ${path}`)
      return file.text
    },
    write: async (path, text) => {
      files.set(path, { text, mtimeMs: d.now.ms })
    },
    list: async path => {
      const hits = [...files.entries()].filter(([p]) => parent(p) === path)
      if (hits.length === 0) throw new Error(`ENOENT: ${path}`)
      return hits.map(([p, f]) => ({ name: base(p), kind: 'file' as const, mtimeMs: f.mtimeMs }))
    },
    exists: async path => files.has(path),
    run: async argv => {
      d.commands.push([...argv])
      if (argv[0] === 'cmd' && argv.includes('del')) files.delete(argv.at(-1) ?? '')
      return { exitCode: 0, stdout }
    },
  }
  return d
}
