/**
 * =============================================================================
 *  Server entry point
 * =============================================================================
 *  Responsible for the process lifecycle only:
 *    boot -> connect to the database -> listen -> shut down cleanly.
 *
 *  Graceful shutdown matters more than it looks. Hosting platforms send SIGTERM
 *  and then kill the process a few seconds later. Without handling it, an
 *  in-flight stock movement can be cut off mid-transaction on every deploy.
 * =============================================================================
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  // Verify the database BEFORE listening. Failing here produces a clear
  // "cannot reach Postgres" at startup instead of a 500 on the first request
  // from a confused user.
  await connectDatabase();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      `LRC-401 API listening on http://localhost:${env.PORT}  [${env.NODE_ENV}]`,
    );
    logger.info(`Accepting browser requests from ${env.CLIENT_URL}`);

    if (env.EMAIL_TRANSPORT === 'console') {
      logger.warn('EMAIL_TRANSPORT=console — invitation emails print here, they are NOT sent');
    }
  });

  /**
   * Ordered shutdown:
   *   1. stop accepting NEW connections
   *   2. let in-flight requests finish
   *   3. close the database pool
   */
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down`);

    // Hard limit: if a request hangs (a stuck query, a slow client), exit anyway
    // rather than being SIGKILLed at an arbitrary point.
    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out after 10s — forcing exit');
      process.exit(1);
    }, 10_000);
    // Do not let this timer keep the process alive if everything closes early.
    forceExit.unref();

    server.close(async () => {
      try {
        await disconnectDatabase();
        clearTimeout(forceExit);
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    });
  };

  // SIGTERM: hosting platform stopping us. SIGINT: Ctrl+C locally.
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  /**
   * A promise rejection nobody handled is a BUG, and the process is now in an
   * unknown state. Log it loudly and let the platform restart us clean rather
   * than serving requests from a process we no longer understand.
   */
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection — exiting');
    process.exit(1);
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — exiting');
    process.exit(1);
  });
}

bootstrap().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start the server');
  process.exit(1);
});
