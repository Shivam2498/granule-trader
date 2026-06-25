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

// jsdom does not implement ResizeObserver; stub it so Mantine Select's ScrollArea works.
if (typeof window !== 'undefined' && typeof (window as Window & { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  (window as Window & { ResizeObserver: unknown }).ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

export function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider theme={theme} forceColorScheme="light">{ui}</MantineProvider>)
}
