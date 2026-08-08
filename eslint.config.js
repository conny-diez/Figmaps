import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import figmaPlugin from '@figma/eslint-plugin-figma-plugins'

export default tseslint.config(
  { ignores: ['build/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@figma/figma-plugins': figmaPlugin },
    rules: {
      // Catches `documentAccess: "dynamic-page"` violations — synchronous access
      // to styles, variables or main components throws at runtime.
      ...figmaPlugin.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'vitest.config.ts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
)
