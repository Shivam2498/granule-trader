import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { theme } from '../../src/renderer/theme'

// jsdom does not implement window.matchMedia; stub it so MantineProvider works.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })
}

export function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider theme={theme} forceColorScheme="light">{ui}</MantineProvider>)
}
