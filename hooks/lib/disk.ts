import type { EngineInterface } from 'claude-code'

export type DiskEntry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs: number }

/** The file calls usagemax makes, narrow enough to fake in a unit test. */
export type Disk = {
  home: () => Promise<string>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<readonly DiskEntry[]>
  exists: (path: string) => Promise<boolean>
  run: (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string }>
}

export function diskOf($: EngineInterface): Disk {
  return {
    home: async () => (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.',
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    list: path => $.fs.list(path),
    exists: path => $.fs.exists(path),
    run: argv => $.process.run(argv, { timeoutMs: 15_000 }),
  }
}
