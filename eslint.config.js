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
        projectService: {
          // The repository scripts are plain Node ES modules, deliberately: CI runs them with
          // `node` and no build step. They belong to no workspace's TypeScript project, so the
          // service is told to infer one for them rather than refuse to parse them.
          allowDefaultProject: ['scripts/*/*.mjs'],
        },
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

  // Repository scripts. Plain Node ES modules, run by `node` in CI and locally, so they are
  // outside every workspace's TypeScript project. They carry a hand-written declaration beside
  // them for the places that import them.
  // Repository scripts. Plain Node ES modules so CI can run them with `node` and no build step;
  // `scripts/tsconfig.json` is what puts them in the TypeScript project graph, so they are linted
  // and type-checked like everything else rather than being a corner nobody looks at.
  {
    files: ['scripts/**/*.{mjs,d.mts}'],
    languageOptions: { globals: { ...globals.node } },
    // A command-line script reports by printing. That is its entire interface.
    rules: { 'no-console': 'off' },
  },

  // Plain JavaScript, so the type-aware rules have nothing real to work with: every value read
  // from a JSON file is `any` by construction and the rules would only ask for casts that assert
  // rather than check. Their declaration in `check.d.mts` is type-checked, which is the part the
  // rest of the codebase depends on. A separate block so the rule changes merge rather than
  // replacing what the blocks above set.
  {
    files: ['scripts/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  prettier,
)
