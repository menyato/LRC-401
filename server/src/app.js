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

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { apiLimiter } from './middleware/rateLimiters.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import apiRoutes from './routes.js';

export function createApp() {
  const app = express();

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
      // This process serves JSON only — the React app is hosted separately as
      // static files. A restrictive CSP here protects the few HTML responses
      // (errors) and costs nothing.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
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
        return callback(new Error('Not allowed by CORS'));
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
