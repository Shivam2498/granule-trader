// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MoneyInput from '../../src/renderer/components/MoneyInput'

afterEach(() => {
  cleanup()
})
describe('MoneyInput', () => {
  it('reports a number on change and treats empty as 0', () => {
    const onChange = vi.fn()
    render(<MoneyInput value={0} onChange={onChange} id="amt" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1234.5' } })
    expect(onChange).toHaveBeenCalledWith(1234.5)
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('re-syncs displayed text when the value prop changes externally', () => {
    const onChange = vi.fn()
    const { rerender } = render(<MoneyInput value={0} onChange={onChange} id="amt" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('')
    rerender(<MoneyInput value={500} onChange={onChange} id="amt" />)
    expect(input.value).toBe('500')
    rerender(<MoneyInput value={0} onChange={onChange} id="amt" />)
    expect(input.value).toBe('')
  })

  it('ignores non-numeric characters', () => {
    const onChange = vi.fn()
    render(<MoneyInput value={0} onChange={onChange} id="amt" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(input.value).toBe('')
    expect(onChange).not.toHaveBeenCalledWith(NaN)
  })
})
