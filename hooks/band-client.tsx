import type { ClientModule } from 'claude-code'

import type { BandView } from '../types'

/**
 * The band above the prompt, drawn by a surface module so that a click anywhere on it can open the
 * panel: the desktop draws a Button from its label alone, so no Button could carry the bars and colours.
 * A left click posts `{ open: true }`; the hooks module opens the panel on it. While the pointer is over
 * the band its background lights up, so it reads as one control (the pointer's shape is the desktop's to choose),
 * and the row says in plain words what its figures mean.
 */
const HOVER_BACKGROUND = '#2c2c2c'

const Band: ClientModule<BandView, { hover: boolean }> = (v, surface) => {
  const { Box, Text } = surface.elements
  const hover = surface.state?.hover === true
  surface.onPointer(e => {
    if (e.type === 'enter' && !hover) surface.setState({ hover: true })
    if (e.type === 'leave' && hover) surface.setState({ hover: false })
    if (e.type === 'up' && (e.button === undefined || e.button === 'left')) surface.post({ open: true })
  })
  if (hover) {
    return (
      <Box flexDirection="row" alignItems="center" flexWrap="nowrap" overflow="hidden" columnGap={1} backgroundColor={HOVER_BACKGROUND}>
        <Text color="claude">{v.ring}</Text>
        <Text color="text" wrap="truncate-end">
          {v.hint}
        </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="row" alignItems="center" flexWrap="nowrap" overflow="hidden" columnGap={2}>
      <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0} borderStyle="round" borderColor="claude" paddingX="xs">
        <Text color="claude">{v.ring}</Text>
        {v.chipLabel !== null && <Text dimColor>{v.chipLabel}</Text>}
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
          {l.used !== null && <Text dimColor>{l.used}</Text>}
          <Text color="text" bold mono tabular>{`${l.pct}%`}</Text>
          {l.resetLabel !== null && <Text dimColor>{l.resetLabel}</Text>}
          {l.reset !== null && <Text dimColor>{l.reset}</Text>}
          {l.estimate !== null && <Text color="warning">{l.estimate}</Text>}
        </Box>
      ))}
    </Box>
  )
}

export default Band
