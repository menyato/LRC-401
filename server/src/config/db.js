/**
 * =============================================================================
 *  Prisma client — the single database connection for the whole process.
 * =============================================================================
 *  Every module imports `prisma` from here. Creating a `new PrismaClient()` in
 *  more than one file is the classic Node memory leak: each instance opens its
 *  own connection pool, and a free-tier Postgres (Neon/Supabase) will start
 *  refusing connections long before you notice.
 * =============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * In development, `node --watch` restarts the module graph on every save. Without
 * caching the client on globalThis we would leak a connection pool per reload.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__lrcPrisma ??
  new PrismaClient({
    // Route Prisma's own logs through our logger rather than raw stdout, so
    // production logs stay in one machine-readable JSON stream.
    log: env.isDevelopment
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
  });

if (env.isDevelopment) {
  globalForPrisma.__lrcPrisma = prisma;

  // Slow-query visibility. Anything over 200ms while developing against a local
  // database almost always means a missing index.
  prisma.$on('query', (event) => {
    if (event.duration >= 200) {
      logger.warn({ durationMs: event.duration, query: event.query }, 'Slow query');
    }
  });
}

prisma.$on('warn', (event) => logger.warn({ prisma: event }, 'Prisma warning'));
prisma.$on('error', (event) => logger.error({ prisma: event }, 'Prisma error'));

/**
 * Verifies the database is reachable before we start accepting HTTP traffic.
 * Failing here gives a clear "cannot reach Postgres" at boot instead of a
 * confusing 500 on the first user request.
 */
export async function connectDatabase() {
  await prisma.$connect();
  logger.info('Database connected');
}

/** Closes the pool cleanly on shutdown so in-flight queries can finish. */
export async function disconnectDatabase() {
  await prisma.$disconnect();
  logger.info('Database disconnected');
}

export default prisma;
