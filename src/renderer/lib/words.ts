const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10), o = n % 10
  return TENS[t] + (o ? '-' + ONES[o] : '')
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100), rest = n % 100
  const parts: string[] = []
  if (h) parts.push(ONES[h] + ' hundred')
  if (rest) parts.push(twoDigits(rest))
  return parts.join(' ')
}

// Indian grouping: crore (2-digit), lakh (2-digit), thousand (2-digit), hundreds (3-digit).
function intToWords(n: number): string {
  if (n === 0) return 'zero'
  const crore = Math.floor(n / 10000000); let rem = n % 10000000
  const lakh = Math.floor(rem / 100000); rem %= 100000
  const thousand = Math.floor(rem / 1000); rem %= 1000
  const parts: string[] = []
  if (crore) parts.push(intToWords(crore) + ' crore')
  if (lakh) parts.push(twoDigits(lakh) + ' lakh')
  if (thousand) parts.push(twoDigits(thousand) + ' thousand')
  if (rem) parts.push(threeDigits(rem))
  return parts.join(' ')
}

// "Rupees <words> [and <words> paise] only" with only the first letter capitalised.
export function rupeesInWords(amount: number): string {
  const rupees = Math.floor(amount + 1e-9)
  const paise = Math.round((amount - rupees) * 100 + 1e-7)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  let words = 'Rupees ' + cap(intToWords(rupees))
  if (paise) words += ' and ' + intToWords(paise) + ' paise'
  return words + ' only'
}
