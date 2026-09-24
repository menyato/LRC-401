/**
 * =============================================================================
 *  Vercel entry point
 * =============================================================================
 *  On Vercel the API runs as ONE function: every /api/* request is rewritten
 *  here (see vercel.json) and handed to the same Express app that `npm start`
 *  runs locally. There is no second copy of the routes to drift out of sync.
 *
 *  The web app itself is served by Vercel as static files from client/dist, on
 *  the same domain — which is what keeps the refresh cookie first-party.
 *
 *  What differs from a long-running server (docs/09-VERCEL.md):
 *    • no graceful shutdown or process-level crash handlers — Vercel owns the
 *      process lifecycle;
 *    • the in-memory rate limiters count per function instance. The per-account
 *      lockout (MAX_FAILED_LOGINS) is stored in the database and still applies
 *      across all of them.
 * =============================================================================
 */

import { createApp } from '../server/src/app.js';

export default createApp();
