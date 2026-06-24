// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import SignedMoneyInput from '../../src/renderer/components/SignedMoneyInput'

describe('SignedMoneyInput', () => {
  beforeEach(() => cleanup())
  it('accepts a negative value and reports a negative number', () => {
    const onChange = vi.fn()
    render(<SignedMoneyInput value={0} onChange={onChange} id="ro" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-0.40' } })
    expect(onChange).toHaveBeenCalledWith(-0.4)
  })
  it('treats empty as 0 and rejects letters', () => {
    const onChange = vi.fn()
    render(<SignedMoneyInput value={0} onChange={onChange} id="ro" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(onChange).not.toHaveBeenCalledWith(NaN)
  })
})
