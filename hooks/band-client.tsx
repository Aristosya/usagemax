import type { ClientModule } from 'claude-code'

import type { BandView } from '../types'

/**
 * The band above the prompt, drawn by a surface module so that a click anywhere on it can open the
 * panel: the desktop draws a Button from its label alone, so no Button could carry the bars and colours.
 * A left click posts `{ open: true }`; the hooks module opens the panel on it.
 */
const Band: ClientModule<BandView> = (v, surface) => {
  const { Box, Text } = surface.elements
  surface.onPointer(e => {
    if (e.type === 'up' && (e.button === undefined || e.button === 'left')) surface.post({ open: true })
  })
  return (
    <Box flexDirection="row" alignItems="center" flexWrap="nowrap" overflow="hidden" columnGap={2}>
      <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0} borderStyle="round" borderColor="claude" paddingX="xs">
        <Text color="claude">{v.ring}</Text>
        <Text color="text" bold mono tabular>
          {v.share}
        </Text>
      </Box>
      {v.limits.map(l => (
        <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
          <Text dimColor>{l.label}</Text>
          <Box flexDirection="row">
            {l.filled > 0 && (
              <Text mono color={l.color}>
                {'━'.repeat(l.filled)}
              </Text>
            )}
            {l.empty > 0 && (
              <Text mono dimColor>
                {'━'.repeat(l.empty)}
              </Text>
            )}
          </Box>
          <Text color="text" bold mono tabular>{`${l.pct}%`}</Text>
          {l.reset !== null && <Text dimColor>{l.reset}</Text>}
          {l.estimate !== null && <Text color="warning">{l.estimate}</Text>}
        </Box>
      ))}
    </Box>
  )
}

export default Band
