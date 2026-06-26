import { describe, it, expect } from 'vitest'
import { rupeesInWords } from '../../src/renderer/lib/words'

describe('rupeesInWords', () => {
  it('matches the ST_006 reference strings', () => {
    expect(rupeesInWords(260000)).toBe('Rupees Two lakh sixty thousand only')
    expect(rupeesInWords(39661.20)).toBe('Rupees Thirty-nine thousand six hundred sixty-one and twenty paise only')
  })
  it('handles zero, hundreds, lakh/crore, and paise', () => {
    expect(rupeesInWords(0)).toBe('Rupees Zero only')
    expect(rupeesInWords(661)).toBe('Rupees Six hundred sixty-one only')
    expect(rupeesInWords(10000000)).toBe('Rupees One crore only')
    expect(rupeesInWords(105.5)).toBe('Rupees One hundred five and fifty paise only')
  })
})
