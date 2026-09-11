/**
 * =============================================================================
 *  Vite configuration
 * =============================================================================
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM has no __dirname. `fileURLToPath` is the correct conversion — slicing the
// URL string by hand produces "/C:/..." on Windows, which is not a valid path.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Reads the API's port from `server/.env` — the same file the server itself
 * reads — so the proxy target cannot drift away from where the API is actually
 * listening.
 *
 * This is not premature cleverness. The port was hard-coded as 4000 here while
 * someone changed `PORT` to 4001 in server/.env (a reasonable way to dodge an
 * "address already in use" error). The two silently disagreed, and every
 * request failed with a bare `ECONNREFUSED` in the Vite log — which says
 * nothing about the cause. Deriving it removes the failure mode entirely.
 *
 * Falls back to 4000, matching the default in server/src/config/env.js.
 */
function readApiPort() {
  try {
    const envFile = path.resolve(projectRoot, '..', 'server', '.env');
    const match = fs.readFileSync(envFile, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);

    if (match) return Number(match[1]);
  } catch {
    // No .env yet (a fresh clone before `cp .env.example .env`) — the default
    // is correct in that case anyway.
  }

  return 4000;
}

const API_PORT = readApiPort();

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Lets us write `import { api } from '@/lib/api'` instead of counting
      // '../../..' segments. Deep relative imports are the main reason moving a
      // component between folders becomes an afternoon of fixing paths.
      '@': path.resolve(projectRoot, 'src'),
    },
  },

  server: {
    port: 5173,
    /**
     * Proxy /api to the backend during development.
     *
     * This makes the browser see ONE origin (localhost:5173), which means:
     *   • no CORS preflight on every request while developing, and
     *   • the httpOnly refresh cookie is treated as first-party, so it behaves
     *     exactly as it will in production behind a single domain.
     * Developing against two origins is the usual reason "it works locally but
     * the cookie disappears in production" — or the reverse.
     */
    proxy: {
      '/api': {
        // Derived from server/.env — see readApiPort() above.
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        /**
         * A bare ECONNREFUSED in the Vite log does not say WHY, and the answer
         * is almost always "the API is not running". Say so.
         */
        configure: (proxy) => {
          proxy.on('error', (error) => {
            if (error.code === 'ECONNREFUSED' || error.errors?.[0]?.code === 'ECONNREFUSED') {
              console.error(
                `\n  [proxy] Cannot reach the API on port ${API_PORT}.` +
                  `\n          Start it with:  npm run dev   (from the project root, runs both)` +
                  `\n          or:             npm --prefix server run dev\n`,
              );
            }
          });
        },
      },
    },
  },

  build: {
    // Source maps make a production stack trace readable. They expose your
    // source, but this is an internal station tool, not proprietary software,
    // and being able to diagnose a bug from a volunteer's screenshot is worth
    // far more.
    sourcemap: true,

    rollupOptions: {
      output: {
        /**
         * Split the big, rarely-changing libraries into their own chunks.
         * A code change then invalidates only the small app chunk, so returning
         * users re-download ~50KB instead of ~600KB — which matters on the
         * mobile connections this will actually be used on.
         */
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query', 'axios'],
          'chart-vendor': ['recharts'],
        },
      },
    },
  },
});
