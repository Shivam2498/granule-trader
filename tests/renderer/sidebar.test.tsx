// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import Sidebar from '../../src/renderer/components/Sidebar'

describe('Sidebar', () => {
  it('shows all six navigation items', () => {
    render(<HashRouter><Sidebar /></HashRouter>)
    for (const label of ['Dashboard','Purchases','Sales','Stock','Customers','Settings'])
      expect(screen.getByText(label)).toBeTruthy()
  })
})
