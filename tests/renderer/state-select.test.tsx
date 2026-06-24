// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StateSelect from '../../src/renderer/components/StateSelect'

describe('StateSelect', () => {
  it('lists states and reports the chosen one', () => {
    const onChange = vi.fn()
    render(<StateSelect value="" onChange={onChange} id="st" />)
    const sel = screen.getByRole('combobox') as HTMLSelectElement
    expect(screen.getByRole('option', { name: 'Gujarat' })).toBeTruthy()
    fireEvent.change(sel, { target: { value: 'Maharashtra' } })
    expect(onChange).toHaveBeenCalledWith('Maharashtra')
  })
})
