/**
 * =============================================================================
 *  Logger
 * =============================================================================
 *  Pino, because it writes structured JSON (searchable in any hosting
 *  provider's log viewer) and is fast enough to leave on in production.
 *
 *  In development we pipe through pino-pretty for human-readable colour output.
 *
 *  THE IMPORTANT PART is `redact`: logs are the most common accidental leak of
 *  credentials. Anything listed below is replaced with [Redacted] no matter
 *  which module logs it, so a careless `logger.info(req.body)` during debugging
 *  cannot write a volunteer's password into a log file.
 * =============================================================================
 */

import pino from 'pino';

// Read straight from process.env rather than importing ./config/env.js:
// env.js may itself want to log a failure, and a circular import would break it.
const level = process.env.LOG_LEVEL || 'info';
const isDevelopment = (process.env.NODE_ENV || 'development') === 'development';

/** Field paths that must never reach a log line, in any shape. */
const REDACTED_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'twoFactorSecret',
  'totpCode',
  'backupCodes',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  // Same keys one level down — request bodies are usually logged as `body.*`.
  '*.password',
  '*.newPassword',
  '*.token',
  '*.twoFactorSecret',
];

export const logger = pino({
  level,
  redact: { paths: REDACTED_PATHS, censor: '[Redacted]' },
  // ISO timestamps; the default is epoch ms, which is unreadable in a terminal.
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

export default logger;
