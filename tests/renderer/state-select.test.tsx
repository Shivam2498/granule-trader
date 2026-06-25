// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import StateSelect from '../../src/renderer/components/StateSelect'

describe('StateSelect', () => {
  it('opens the dropdown and reports the chosen state', () => {
    const onChange = vi.fn()
    renderWithMantine(<StateSelect value="" onChange={onChange} id="st" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.click(input)                      // open the Mantine Select dropdown
    fireEvent.click(screen.getByText('Gujarat'))
    expect(onChange).toHaveBeenCalledWith('Gujarat')
  })
})
