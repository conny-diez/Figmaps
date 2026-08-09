import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

/** Dieselbe Quelle wie im Build: `package.json`, siehe `src/version.ts`. */
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string

export default defineConfig({
  define: { __PACKAGE_VERSION__: JSON.stringify(packageVersion) },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'eval/**/*.test.ts'],
  },
})
