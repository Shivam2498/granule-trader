// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import FirstRun from '../../src/renderer/screens/FirstRun'

describe('FirstRun new business fields', () => {
  it('renders the new required invoice fields', () => {
    renderWithMantine(<FirstRun onDone={() => {}} />)
    for (const label of ['Godown address', 'UDYAM No. (optional)', 'Email', 'Bank name', 'Bank branch', 'Bank A/C No.', 'IFSC'])
      expect(screen.getByText(label)).toBeTruthy()
  })
})
