// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import { FYProvider } from '../../src/renderer/fy'
import FYSelect from '../../src/renderer/components/FYSelect'

describe('FYSelect', () => {
  beforeEach(() => {
    ;(globalThis as any).window.api = { listFinancialYears: vi.fn().mockResolvedValue(['2024-25']) }
  })
  it('defaults to the current FY and lists returned years', async () => {
    renderWithMantine(<FYProvider><FYSelect /></FYProvider>)
    // The Select renders a textbox input whose value is the current FY label (YYYY-YY).
    const input = screen.getByRole('textbox', { name: 'Financial year' }) as HTMLInputElement
    await waitFor(() => expect(input.value).toMatch(/^\d{4}-\d{2}$/))
  })
})
