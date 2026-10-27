import path from 'node:path';
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const API_SOURCE = path.resolve(import.meta.dirname, '../src');

/**
 * SPEC W1: the web client holds no business rules. It must not import the
 * API's code in ../src (rules, schemas, SQL); it reaches the API only over
 * HTTP, through the generated client in src/api.
 */
const noApiImports = {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid imports from the API source folder (SPEC W1)' },
    messages: { api: 'web/ must not import the API code in src/ (SPEC W1). Call the API through src/api/client.ts.' },
    schema: [],
  },
  create(context) {
    const check = (node) => {
      const source = node.source;
      if (source?.type !== 'Literal' || typeof source.value !== 'string' || !source.value.startsWith('.')) return;
      const target = path.resolve(path.dirname(context.filename), source.value);
      if (target === API_SOURCE || target.startsWith(API_SOURCE + path.sep)) context.report({ node: source, messageId: 'api' });
    };
    return { ImportDeclaration: check, ExportAllDeclaration: check, ExportNamedDeclaration: check, ImportExpression: check };
  },
};

export default defineConfig(
  // Generated: shadcn/ui components and the API types.
  { ignores: ['src/components/ui/', 'src/api/schema.d.ts'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { w1: { rules: { 'no-api-imports': noApiImports } } },
    rules: {
      'w1/no-api-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
