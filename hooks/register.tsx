import type { Register } from 'claude-code'

import { usageButton } from './button'
import { capture } from './capture'
import { commands } from './commands'
import { footer } from './footer'
import { usagePanel } from './panel'
import { toasts } from './toasts'

export const register: Register = on => {
  capture(on)
  footer(on)
  usageButton(on)
  usagePanel(on)
  commands(on)
  toasts(on)
}
