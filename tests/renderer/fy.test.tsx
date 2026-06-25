// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import { FYProvider } from '../../src/renderer/fy'
import FYSelect from '../../src/renderer/components/FYSelect'
import { financialYear } from '../../src/main/core/financial-year'
import { today } from '../../src/renderer/lib/format'

describe('FYSelect', () => {
  beforeEach(() => {
    ;(globalThis as any).window.api = { listFinancialYears: vi.fn().mockResolvedValue(['2024-25']) }
  })
  it('defaults to the current FY and lists the returned years', async () => {
    renderWithMantine(<FYProvider><FYSelect /></FYProvider>)
    // The Select renders a textbox input whose value is the current FY label (YYYY-YY).
    const input = screen.getByRole('textbox', { name: 'Financial year' }) as HTMLInputElement
    const current = financialYear(today()).label
    await waitFor(() => expect(input.value).toBe(current))
    // Opening the dropdown shows both the current FY and the fetched year as options.
    fireEvent.click(input)
    await waitFor(() => expect(screen.getByRole('option', { name: '2024-25' })).toBeTruthy())
    expect(screen.getByRole('option', { name: current })).toBeTruthy()
  })
})
