/**
 * =============================================================================
 *  ESLint — the checks the build cannot do
 * =============================================================================
 *  Vite's build only cares whether the code PARSES. It happily ships a file
 *  that references a variable which does not exist, because that is a runtime
 *  error, not a syntax one.
 *
 *  That is not hypothetical here. Moving the delete button out of the question
 *  editor left `onClick={onDelete}` behind, with `onDelete` no longer in scope.
 *  The build passed. The form builder's Edit button then crashed the moment it
 *  opened, and the only way to find it was to read the file.
 *
 *  `no-undef` catches exactly that, in under a second.
 *
 *      npm run lint
 * =============================================================================
 */

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';

export default [
  {
    // Build output and dependencies are not ours to lint.
    ignores: ['dist/**', 'node_modules/**'],
  },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],

    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Vite injects these.
        ...globals.es2021,
      },
      parserOptions: {
        // JSX without this is a parse error.
        ecmaFeatures: { jsx: true },
      },
    },

    plugins: {
      'react-hooks': reactHooks,
      react,
    },

    settings: { react: { version: 'detect' } },

    rules: {
      /**
       * THE RULE THIS CONFIG EXISTS FOR. A reference to something that was
       * never declared is always a bug, and it is invisible until the exact
       * line runs.
       */
      'no-undef': 'error',

      /**
       * Usually harmless, but it is how a half-finished refactor announces
       * itself — an import left behind after the code that used it went away.
       * Warn rather than error so it never blocks a build.
       *
       * Arguments are exempt: Express error handlers need four parameters to be
       * recognised as error handlers, whether or not `next` is used.
       */
      'no-unused-vars': [
        'warn',
        {
          args: 'none',
          // Deliberately-ignored destructured values, e.g. `const { a, ..rest }`.
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],

      /**
       * Without this, `no-unused-vars` does not understand JSX: it sees the
       * import of a component and never sees `<Component />` as a use, so every
       * component import is reported as unused. That produced 305 false
       * warnings on the first run — enough noise to bury the one real finding,
       * which is exactly how a lint setup gets ignored and then removed.
       */
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',

      /**
       * THE COMPANION TO `no-undef`, AND THE ONE THAT WAS MISSING.
       *
       * ESLint's core `no-undef` does not treat a JSX element name as a
       * variable reference, so `<ThemeProvider />` with no import passes it
       * cleanly. That is exactly the bug that shipped: the JSX was added to
       * main.jsx while the import was not, lint reported zero errors, the build
       * succeeded, and the app rendered a blank white page with
       * "ThemeProvider is not defined" in the console.
       *
       * A blank page is the worst failure mode there is — nothing on screen
       * says what went wrong. This rule turns it into a one-line lint error.
       */
      'react/jsx-no-undef': 'error',

      // Rules of Hooks. Getting these wrong produces bugs that look like
      // "React is behaving randomly", which is the worst kind to debug.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // `==` against null is idiomatic; everywhere else it hides type coercion.
      eqeqeq: ['warn', 'smart'],

      // A `console.log` left in shipped code is noise in a volunteer's browser.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
