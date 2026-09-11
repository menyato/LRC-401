/**
 * =============================================================================
 *  Wait for the API to be ready
 * =============================================================================
 *  WHY THIS EXISTS
 *
 *  `npm run dev` starts the API and the web server at the same time. Vite is
 *  serving in about three seconds; the API takes longer, because it connects to
 *  PostgreSQL and validates its environment before it binds a port.
 *
 *  The browser does not wait. It reconnects the instant Vite is up and
 *  immediately calls /api/auth/refresh, which lands in that gap and fails with:
 *
 *      [vite] http proxy error: /api/auth/login
 *      Error: read ECONNRESET
 *
 *  Nothing is broken — the API simply was not listening yet. But the message
 *  says nothing about that, it appears on every single start, and it teaches you
 *  to ignore proxy errors, which is exactly when a real one will slip past.
 *
 *  So the web server now waits for the API to answer its health check first.
 *
 *  IT DOES NOT BLOCK FOREVER. If the API cannot start — a bad DATABASE_URL, a
 *  missing secret — waiting would just hide the real error behind a hung
 *  terminal. After the timeout this gives up, says so, and lets Vite start
 *  anyway so you can read the API's own error in the other pane.
 *  NOTE ON THE .mjs EXTENSION: the root package.json has no `"type": "module"`,
 *  so a plain .js file here would be treated as CommonJS — and this script uses
 *  top-level await and `import.meta.dirname`, which are ESM-only.
 * =============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';

const PORT = readApiPort();
const URL = `http://localhost:${PORT}/api/health`;

/** How long to wait before giving up and starting anyway. */
const TIMEOUT_MS = 30_000;
const POLL_MS = 250;

/**
 * Reads the API's port from server/.env, the same file the server reads, so
 * changing PORT cannot leave this polling the wrong place.
 */
function readApiPort() {
  try {
    const envPath = path.resolve(import.meta.dirname, '..', 'server', '.env');
    const match = fs.readFileSync(envPath, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);

    if (match) return Number(match[1]);
  } catch {
    // No .env yet — the default below is correct for a fresh clone.
  }

  return 4000;
}

/**
 * Polls until the API answers, or the timeout expires.
 *
 * Written as a function that RETURNS rather than calling process.exit():
 * exiting immediately after a fetch tears the process down while undici still
 * holds an open socket, and on Windows libuv aborts with
 *
 *     Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)
 *
 * which turns a successful wait into a crash. Letting the event loop drain on
 * its own avoids it entirely.
 */
async function waitForApi() {
  const startedAt = Date.now();
  let announced = false;

  while (Date.now() - startedAt < TIMEOUT_MS) {
    try {
      const response = await fetch(URL, { signal: AbortSignal.timeout(1500) });

      if (response.ok) {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`
  API ready on port ${PORT} after ${seconds}s — starting the web server
`);
        return true;
      }
    } catch {
      // Not up yet. Expected for the first few seconds.
    }

    // Say something once, so a slow start does not look like a hang.
    if (!announced && Date.now() - startedAt > 2000) {
      console.log(`  Waiting for the API on port ${PORT}...`);
      announced = true;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  console.warn(
    `
  The API did not answer on port ${PORT} within ${TIMEOUT_MS / 1000}s.` +
      `
  Starting the web server anyway — check the API pane above for the reason.` +
      `
  (A bad DATABASE_URL or a missing secret in server/.env are the usual causes.)
`,
  );

  return false;
}

// Always exit 0, even on timeout: a non-zero code would stop `concurrently`
// from starting the web server at all, and then neither error would be visible.
await waitForApi();
process.exitCode = 0;
