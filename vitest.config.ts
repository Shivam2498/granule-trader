import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
export default defineConfig({
  test: { environment: 'node', globals: true, include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'tests/**/*.test.mjs'] },
  resolve: { alias: { '@shared': resolve('src/shared') } }
})
