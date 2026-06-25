// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import Sidebar from '../../src/renderer/components/Sidebar'

describe('Sidebar', () => {
  it('shows all seven navigation items', () => {
    renderWithMantine(<HashRouter><Sidebar /></HashRouter>)
    for (const label of ['Dashboard','Purchases','Sales','Stock','Customers','Suppliers','Settings'])
      expect(screen.getByText(label)).toBeTruthy()
  })
})
