import { createTheme } from '@mantine/core'

// Senior-friendly: larger base text, comfortable controls, calm blue primary.
export const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSizes: { xs: '14px', sm: '16px', md: '17px', lg: '19px', xl: '22px' },
  headings: { sizes: { h1: { fontSize: '28px' }, h2: { fontSize: '22px' }, h3: { fontSize: '18px' } } },
  components: {
    TextInput: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md' } },
    Textarea: { defaultProps: { size: 'md' } },
    Button: { defaultProps: { size: 'md' } }
  }
})
