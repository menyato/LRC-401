/**
 * =============================================================================
 *  Environment configuration — validated ONCE at boot.
 * =============================================================================
 *  Why validate the environment at all?
 *
 *  The classic production incident is a server that starts happily with
 *  `JWT_SECRET=undefined`, signs tokens with the string "undefined", and is
 *  trivially forgeable. We refuse to start instead. A server that will not boot
 *  is a loud, immediate, fixable problem; a server that boots insecurely is a
 *  silent one.
 *
 *  Everything else in the codebase imports `env` from here and never touches
 *  `process.env` directly. That gives us one place to see every knob the app has.
 * =============================================================================
 */

import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env into process.env. In production the platform (Render/Fly/Railway)
// injects real environment variables and there is simply no .env file to find,
// which dotenv handles silently.
dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

/**
 * A secret must be long enough that brute-forcing the signature is hopeless,
 * and must not still be the placeholder from .env.example.
 */
const secret = (name) =>
  z
    .string({ required_error: `${name} is required` })
    .min(32, `${name} must be at least 32 characters`)
    .refine((v) => !v.startsWith('replace_me'), {
      message: `${name} is still the placeholder from .env.example — generate a real value`,
    });

/** Accepts "15m", "24h", "7d" — the format jsonwebtoken understands. */
const duration = z.string().regex(/^\d+[smhd]$/, 'must look like 15m, 2h or 7d');

/** Environment variables arrive as strings; coerce the ones we want as numbers. */
const numeric = (fallback) => z.coerce.number().int().positive().default(fallback);

const schema = z
  .object({
    // --- Core ---------------------------------------------------------------
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: numeric(4000),
    CLIENT_URL: z.string().url().default('http://localhost:5173'),

    // --- Database -----------------------------------------------------------
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
        message: 'DATABASE_URL must be a PostgreSQL connection string',
      }),

    // --- Secrets ------------------------------------------------------------
    JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
    JWT_MFA_SECRET: secret('JWT_MFA_SECRET'),
    // 32 bytes expressed as hex = 64 characters. AES-256-GCM needs exactly this.
    TOTP_ENC_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'TOTP_ENC_KEY must be exactly 64 hexadecimal characters'),

    // --- Token lifetimes ----------------------------------------------------
    ACCESS_TOKEN_TTL: duration.default('15m'),
    MFA_TOKEN_TTL: duration.default('5m'),
    REFRESH_TOKEN_TTL_DAYS: numeric(30),
    INVITE_TTL_HOURS: numeric(72),
    PASSWORD_RESET_TTL_MINUTES: numeric(60),

    // --- Brute-force protection --------------------------------------------
    MAX_FAILED_LOGINS: numeric(5),
    ACCOUNT_LOCK_MINUTES: numeric(15),

    // --- Email --------------------------------------------------------------
    EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    EMAIL_FROM: z.string().default('LRC Saida 401 <no-reply@lrc401.org>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: z.coerce.boolean().default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),

    // --- Seed ---------------------------------------------------------------
    SEED_SUPERADMIN_EMAIL: z.string().email().default('admin@lrc401.local'),
    SEED_SUPERADMIN_PASSWORD: z.string().min(10).default('ChangeMe!2026'),
    SEED_SUPERADMIN_NAME: z.string().default('Station Super Admin'),

    // --- Logging ------------------------------------------------------------
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  })
  // Cross-field rules that a per-field schema cannot express.
  .superRefine((cfg, ctx) => {
    // Choosing SMTP without credentials would fail silently at the first
    // invitation — i.e. exactly when a new volunteer is waiting for an email.
    if (cfg.EMAIL_TRANSPORT === 'smtp') {
      for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when EMAIL_TRANSPORT=smtp`,
          });
        }
      }
    }

    // Reusing one secret for several purposes means a leak in one context
    // (say, a logged refresh token) compromises all the others.
    const secrets = [cfg.JWT_ACCESS_SECRET, cfg.JWT_REFRESH_SECRET, cfg.JWT_MFA_SECRET];
    if (new Set(secrets).size !== secrets.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET, JWT_REFRESH_SECRET and JWT_MFA_SECRET must all differ',
      });
    }

    // Guard rails that only matter once real volunteer data is in the system.
    if (cfg.NODE_ENV === 'production') {
      if (cfg.EMAIL_TRANSPORT === 'console') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_TRANSPORT'],
          message: 'EMAIL_TRANSPORT=console in production means invitations are never delivered',
        });
      }
      if (cfg.CLIENT_URL.startsWith('http://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLIENT_URL'],
          message: 'CLIENT_URL must use https in production (cookies are set Secure)',
        });
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // Deliberately using console here rather than the logger: the logger itself
  // is configured from env, so it may not exist yet at this point.
  console.error('\n  Invalid environment configuration — the server will not start.\n');
  for (const issue of parsed.error.issues) {
    console.error(`   • ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  console.error('\n  Fix server/.env (compare it against server/.env.example) and try again.\n');
  process.exit(1);
}

/**
 * The validated, frozen configuration object.
 * Frozen so no module can mutate config at runtime and confuse another.
 */
export const env = Object.freeze({
  ...parsed.data,
  isProduction,
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
});

export default env;
