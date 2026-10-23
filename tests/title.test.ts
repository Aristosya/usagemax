import { expect, test } from 'claude-code/testing'

import { resolveTitle, titleFromTranscript, transcriptPath } from '../hooks/lib/title'
import { HOME, memDisk } from './memdisk'

const LINES = [
  '{"type":"user","message":"hi"}',
  '{"type":"ai-title","aiTitle":"Auto title","sessionId":"s1"}',
  '{"type":"custom-title","customTitle":"Old name","sessionId":"s1"}',
  '{"type":"custom-title","customTitle":"Sidebar name","sessionId":"s1"}',
  '{"type":"ai-title","aiTitle":"Later auto title","sessionId":"s1"}',
].join('\n')

test('prefers the last custom title, then the last AI title', () => {
  expect(titleFromTranscript(LINES)).toBe('Sidebar name')
  expect(titleFromTranscript('{"type":"ai-title","aiTitle":"A"}\n{"type":"ai-title","aiTitle":"B"}')).toBe('B')
  expect(titleFromTranscript('{"type":"user"}')).toBeNull()
})

test('builds the transcript path from the working folder', () => {
  expect(transcriptPath(HOME, 'C:\\projects\\demo-app', 's1')).toBe(`${HOME}\\.claude\\projects\\C--projects-demo-app\\s1.jsonl`)
})

test('takes the sidebar title', async () => {
  const d = memDisk()
  await d.write(transcriptPath(HOME, 'C:\\work', 's1'), LINES)
  expect(await resolveTitle(d, 'C:\\work', 's1', 'first request')).toBe('Sidebar name')
})

/** What the PowerShell script prints: each matching line as base64 of its UTF-8 bytes. */
const asBase64 = (line: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(line)))

test('reads a large transcript through PowerShell', async () => {
  const lines = [
    '{"type":"ai-title","aiTitle":"Авто","sessionId":"s1"}',
    '{"type":"custom-title","customTitle":"Т31 экраны","sessionId":"s1"}',
  ]
  const d = memDisk(1, `${lines.map(asBase64).join('\r\n')}\r\n`)
  expect(await resolveTitle(d, 'C:\\work', 's1', 'first request')).toBe('Т31 экраны')
  expect(d.commands[0]?.[0]).toBe('powershell')
})

test('asks PowerShell for ASCII-only output and passes no double quotes', async () => {
  const d = memDisk(1, '')
  await resolveTitle(d, 'C:\\work', 's1', 'first request')
  const script = d.commands[0]?.at(-1) ?? ''
  expect(script).toContain('ToBase64String')
  expect(script).toContain('-Encoding UTF8')
  expect(script.includes('"')).toBe(false)
})

test('falls back to the first message', async () => {
  expect(await resolveTitle(memDisk(), 'C:\\work', 's1', 'y'.repeat(60))).toBe('y'.repeat(40))
})
