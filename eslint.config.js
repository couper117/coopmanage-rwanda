import js from '@eslint/js'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/backend/prisma/migrations/**',
      'apps/frontend/dist/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The project rule from docs/architecture.md: `any` is not allowed. An unavoidable case
      // must carry an eslint-disable comment with a written reason, which review can see.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // A forgotten await on a database write is a data-integrity bug, not a style issue.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Backend
  {
    files: ['apps/backend/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/backend/prisma/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Shared
  {
    files: ['packages/shared/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Frontend
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Accessibility is a stated requirement, so these are errors rather than warnings.
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/label-has-associated-control': 'off', // htmlFor is used; the rule misreads FormField
    },
  },

  // Tests
  {
    files: ['**/test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Config files run outside the TypeScript project graph.
  {
    files: ['*.js', '*.config.{js,ts}', 'apps/*/*.config.{js,ts}', 'apps/*/prisma.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
)
