import type { Disk } from './disk'

const TITLE_CHARS = 40

/** The sidebar's name in a transcript: the last `custom-title`, else the last `ai-title`. */
export function titleFromTranscript(text: string): string | null {
  let custom: string | null = null
  let ai: string | null = null
  for (const line of text.split('\n')) {
    if (!line.includes('-title"')) continue
    try {
      const row = JSON.parse(line) as { type?: string; customTitle?: unknown; aiTitle?: unknown }
      if (row.type === 'custom-title' && typeof row.customTitle === 'string') custom = row.customTitle
      if (row.type === 'ai-title' && typeof row.aiTitle === 'string') ai = row.aiTitle
    } catch {
      // A line cut short or a nested quote: not a title record.
    }
  }
  return custom ?? ai
}

/** Base64 lines of UTF-8 text back to text; a line that is not base64 is dropped. */
function decodeLines(stdout: string): string {
  const out: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      out.push(new TextDecoder().decode(Uint8Array.from(atob(line.trim()), c => c.charCodeAt(0))))
    } catch {
      // Not base64: PowerShell printed an error or a warning.
    }
  }
  return out.join('\n')
}

export function transcriptPath(home: string, cwd: string, sessionId: string): string {
  return `${home}\\.claude\\projects\\${cwd.replace(/[^A-Za-z0-9]/g, '-')}\\${sessionId}.jsonl`
}

/** The chat's sidebar name; files past the 4 MiB read limit go through PowerShell; else the first request. */
export async function resolveTitle(d: Disk, cwd: string, sessionId: string, firstPrompt: string): Promise<string> {
  const path = transcriptPath(await d.home(), cwd, sessionId)
  let title: string | null = null
  try {
    title = titleFromTranscript(await d.read(path))
  } catch {
    try {
      const literal = path.replace(/'/g, "''")
      const run = await d.run([
        'powershell',
        '-NoProfile',
        '-Command',
        // Each match comes back as base64 of its UTF-8 bytes: the engine starts PowerShell without a console,
        // where the output code page turned Cyrillic into `?`. The script holds no double quotes, which the
        // command line would have to escape.
        `Select-String -LiteralPath '${literal}' -Encoding UTF8 -Pattern 'type.:.(custom|ai)-title' | Select-Object -Last 20 | ForEach-Object { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Line)) }`,
      ])
      if (run.exitCode === 0) title = titleFromTranscript(decodeLines(run.stdout))
    } catch {
      // No PowerShell: fall back below.
    }
  }
  return title ?? firstPrompt.slice(0, TITLE_CHARS)
}
