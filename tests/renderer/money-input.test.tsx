// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import MoneyInput from '../../src/renderer/components/MoneyInput'

describe('MoneyInput', () => {
  it('reports a number on change and treats empty as 0', () => {
    const onChange = vi.fn()
    renderWithMantine(<MoneyInput value={0} onChange={onChange} id="amt" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1234.5' } })
    expect(onChange).toHaveBeenCalledWith(1234.5)
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })
})
