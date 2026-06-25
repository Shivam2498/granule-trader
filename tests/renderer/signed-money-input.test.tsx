// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen, fireEvent, cleanup } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import SignedMoneyInput from '../../src/renderer/components/SignedMoneyInput'

describe('SignedMoneyInput', () => {
  afterEach(() => cleanup())

  it('accepts a negative value', () => {
    const onChange = vi.fn()
    renderWithMantine(<SignedMoneyInput value={0} onChange={onChange} id="ro" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-0.4' } })
    expect(onChange).toHaveBeenCalledWith(-0.4)
  })

  it('treats empty as 0', () => {
    const onChange = vi.fn()
    renderWithMantine(<SignedMoneyInput value={5} onChange={onChange} id="ro" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })
})
