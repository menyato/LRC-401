/**
 * =============================================================================
 *  Express application
 * =============================================================================
 *  Builds and configures the app WITHOUT starting a server. Keeping "build the
 *  app" separate from "listen on a port" (src/index.js) means tests can import
 *  this file and make requests against it without binding a socket.
 *
 *  MIDDLEWARE ORDER MATTERS AND IS NOT ARBITRARY. Each block below explains why
 *  it sits where it does. Reordering them silently breaks things — e.g. moving
 *  the body parser after the routes makes every `req.body` undefined.
 * =============================================================================
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import pinoHttp from 'pino-http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimiters.js';
import { rejectNulBytes } from './middleware/rejectNulBytes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import apiRoutes from './routes.js';
import { ApiError } from './utils/ApiError.js';

/** The built React app: client/dist, two levels up from server/src. */
const CLIENT_DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'client',
  'dist',
);

/**
 * Loads the built web app when SERVE_CLIENT is on, and fails at BOOT if it is
 * missing — a server that starts and then serves a 404 for "/" looks healthy to
 * the platform's health check while every volunteer sees a blank page.
 *
 * Also returns the CSP hashes of index.html's inline scripts. There is exactly
 * one — the theme script that must run before first paint — and hashing it lets
 * the policy stay `script-src 'self'` instead of opening up 'unsafe-inline'.
 * Computed from the built file, so editing the script cannot desync the hash.
 */
function loadClient() {
  if (!env.SERVE_CLIENT) return null;

  const indexPath = path.join(CLIENT_DIST, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`SERVE_CLIENT=true but ${indexPath} does not exist — run \`npm run build\` first`);
  }

  const html = fs.readFileSync(indexPath, 'utf8');
  const scriptHashes = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    // The browser hashes the script AFTER the HTML parser turns CRLF into LF,
    // so a file built on Windows must be normalised the same way or the hash
    // never matches and the theme script is silently blocked.
    ([, body]) => {
      const normalised = body.replace(/\r\n?/g, '\n');
      return `'sha256-${crypto.createHash('sha256').update(normalised).digest('base64')}'`;
    },
  );

  return { scriptHashes };
}

export function createApp() {
  const app = express();
  const client = loadClient();

  // ---------------------------------------------------------------------------
  //  1. Trust proxy
  // ---------------------------------------------------------------------------
  //  Render/Fly/Railway put a load balancer in front of us. Without this, every
  //  request appears to come from the proxy's IP — which would make the rate
  //  limiters treat the whole internet as one client, and log useless IPs.
  //
  //  Value is 1 (trust ONE hop), not `true`. Trusting all hops lets a client
  //  spoof `X-Forwarded-For` and bypass IP-based rate limiting entirely.
  // ---------------------------------------------------------------------------
  if (env.isProduction) {
    app.set('trust proxy', 1);
  }

  // Do not advertise the framework. Free reconnaissance for an attacker.
  app.disable('x-powered-by');

  // ---------------------------------------------------------------------------
  //  2. Security headers
  // ---------------------------------------------------------------------------
  app.use(
    helmet({
      // Strict either way: with SERVE_CLIENT this is the React app's policy too.
      // The app loads nothing from third parties, so 'self' plus the hash of
      // the one inline theme script is all it needs.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", ...(client?.scriptHashes ?? [])],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"], // clickjacking protection
        },
      },
      // Browsers should not guess content types; prevents a JSON response being
      // interpreted as HTML and executed.
      noSniff: true,
      // Do not leak our URLs (which contain record ids) to third-party sites.
      referrerPolicy: { policy: 'no-referrer' },
      // 180 days of forced HTTPS, production only.
      hsts: env.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  );

  // ---------------------------------------------------------------------------
  //  3. CORS
  // ---------------------------------------------------------------------------
  //  The API and the web app are on different origins, so the browser needs
  //  explicit permission. An ALLOW-LIST, never `origin: true` — reflecting any
  //  origin combined with `credentials: true` would let any website on the
  //  internet make authenticated requests using the user's refresh cookie.
  // ---------------------------------------------------------------------------
  const allowedOrigins = new Set([env.CLIENT_URL]);

  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header = same-origin, curl, or a mobile app. Not a browser
        // cross-site request, so there is nothing for CORS to protect against.
        if (!origin) return callback(null, true);

        if (allowedOrigins.has(origin)) return callback(null, true);

        logger.warn({ origin }, 'Blocked CORS request from unknown origin');
        // An ApiError, not a bare Error: a bare one reached the error handler
        // as an unknown bug and came back as a 500, which reads as "the server
        // crashed" in logs and uptime monitors.
        return callback(ApiError.forbidden('Origin not allowed', { code: 'CORS_REJECTED' }));
      },
      // Required for the httpOnly refresh cookie to be sent and set.
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      // Cache the preflight for 10 minutes to cut round trips on slow networks.
      maxAge: 600,
    }),
  );

  // ---------------------------------------------------------------------------
  //  4. Body parsing
  // ---------------------------------------------------------------------------
  //  MUST come before routes. The 1MB cap is deliberate: the largest legitimate
  //  request is an equipment report with ~200 answers (a few KB). Anything
  //  approaching a megabyte is a mistake or an attack, and rejecting it early
  //  costs no memory.
  // ---------------------------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // ---------------------------------------------------------------------------
  //  5. HTTP Parameter Pollution
  // ---------------------------------------------------------------------------
  //  `?sortBy=name&sortBy=passwordHash` makes Express produce an ARRAY where the
  //  code expects a string, which can slip past a validator written for the
  //  simple case. hpp keeps the last value only.
  // ---------------------------------------------------------------------------
  app.use(hpp());

  // Postgres cannot store U+0000; refuse it before it reaches a query and
  // becomes a 500. See middleware/rejectNulBytes.js.
  app.use(rejectNulBytes);

  // ---------------------------------------------------------------------------
  //  6. Compression
  // ---------------------------------------------------------------------------
  //  Paginated JSON compresses ~80%. That is a real difference for a volunteer
  //  on mobile data at the station.
  // ---------------------------------------------------------------------------
  app.use(compression());

  // ---------------------------------------------------------------------------
  //  7. Request logging
  // ---------------------------------------------------------------------------
  app.use(
    pinoHttp({
      logger,
      // Health checks would otherwise flood the logs every 30 seconds.
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // Trim the default serializers: the full request object includes headers
      // (with the Authorization bearer token) on every single line.
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // ---------------------------------------------------------------------------
  //  8. Health check — BEFORE the rate limiter
  // ---------------------------------------------------------------------------
  //  Hosting platforms poll this to decide whether the instance is alive. If it
  //  sat behind the limiter, a traffic spike could rate-limit the health check
  //  and the platform would restart a perfectly healthy server.
  // ---------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });

  // ---------------------------------------------------------------------------
  //  9. Routes (behind the global rate limiter)
  // ---------------------------------------------------------------------------
  app.use('/api', apiLimiter, apiRoutes);

  // ---------------------------------------------------------------------------
  //  9b. The web app itself (SERVE_CLIENT=true)
  // ---------------------------------------------------------------------------
  //  One process serving both the API and the React build is what keeps the
  //  refresh cookie first-party in production: same origin, no proxy, no CORS.
  //  Mounted AFTER /api so an unknown API path still gets a JSON 404 below
  //  rather than the app's HTML.
  // ---------------------------------------------------------------------------
  if (client) {
    // Vite fingerprints everything under /assets (index-DOwDLiJk.js), so a new
    // deploy always has new file names and these can be cached for a year.
    app.use(
      '/assets',
      express.static(path.join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '1y', index: false }),
    );
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));

    // Client-side routing: /reports/board on refresh must return the app, not a
    // 404. index.html is never cached, or a deploy would leave phones running
    // the old bundle against the new API.
    app.get(/^\/(?!api(\/|$)).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(CLIENT_DIST, 'index.html'));
    });
  }

  // ---------------------------------------------------------------------------
  //  10. Error handling — ALWAYS LAST
  // ---------------------------------------------------------------------------
  //  Express matches middleware in registration order, so these must come after
  //  every route. Registered earlier, they would never run.
  // ---------------------------------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
