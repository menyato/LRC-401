/**
 * =============================================================================
 *  ESLint — server
 * =============================================================================
 *  Same purpose as the client config: catch references to things that do not
 *  exist. Node will not tell you until the exact line runs, which on a server
 *  means a 500 in front of a user rather than an error at your desk.
 *
 *      npm run lint
 * =============================================================================
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'prisma/migrations/**'],
  },

  js.configs.recommended,

  {
    files: ['**/*.js'],

    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },

    rules: {
      // The rule that earns this file its place.
      'no-undef': 'error',

      /**
       * `args: 'none'` matters here specifically: Express identifies an error
       * handler by its FOUR-parameter signature, so `next` must stay in the
       * list even though it is unused. Flagging it would push someone into
       * "fixing" it and silently turning the error handler into ordinary
       * middleware that never runs.
       */
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],

      eqeqeq: ['warn', 'smart'],

      /**
       * The server has a real logger (pino) with redaction configured. A bare
       * console.log bypasses it, so a password or a token could reach the logs
       * in clear. The seed and the scripts legitimately print to a terminal —
       * they are exempted below.
       */
      'no-console': 'warn',

      // `await` inside a loop is sometimes exactly right (sequential stock
      // movements against one lot), so this stays advisory.
      'require-atomic-updates': 'warn',
    },
  },

  {
    // Scripts and the seed are command-line tools whose entire output is
    // console, and they never handle a request.
    files: ['prisma/seed.js', 'prisma/seed-data/**', 'scripts/**'],
    rules: { 'no-console': 'off' },
  },

  {
    /**
     * env.js prints deliberately. It validates the environment BEFORE the
     * logger exists — the logger is configured from env — so a console write is
     * the only way to report a bad configuration at that point.
     */
    files: ['src/config/env.js'],
    rules: { 'no-console': 'off' },
  },
];
