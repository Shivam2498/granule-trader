// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import Sidebar from '../../src/renderer/components/Sidebar'
import { FYProvider } from '../../src/renderer/fy'

describe('Sidebar', () => {
  beforeEach(() => {
    ;(globalThis as any).window.api = { listFinancialYears: vi.fn().mockResolvedValue([]) }
  })
  it('shows all seven navigation items', () => {
    renderWithMantine(<HashRouter><FYProvider><Sidebar /></FYProvider></HashRouter>)
    for (const label of ['Dashboard','Purchases','Sales','Stock','Customers','Suppliers','Settings'])
      expect(screen.getByText(label)).toBeTruthy()
  })
})
