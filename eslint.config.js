import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const tsFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const jsFiles = ['**/*.js', '**/*.cjs', '**/*.mjs'];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '**/dist/**',
      '.codex/**',
      '.tmp/**',
      'tmp/**',
      'screenshots/**',
      'vscode-extension/out/**',
      'vscode-extension/node_modules/**',
      '**/*.d.ts',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: jsFiles,
    rules: {
      ...js.configs.recommended.rules,
      'no-control-regex': 'off',
    },
  },
  {
    files: tsFiles,
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^ignored' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-control-regex': 'off',
    },
  },
  {
    files: ['packages/safe-js/src/interp/arguments.ts'],
    rules: {
      'prefer-rest-params': 'off',
    },
  },
  {
    files: ['packages/agent-spawn/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['poe-code/src/*'],
              message: 'Import from poe-code public API, not src/',
            },
          ],
        },
      ],
    },
  }
);
