/**
 * =============================================================================
 *  asyncHandler — removes try/catch from every single controller.
 * =============================================================================
 *  Express 4 does not catch rejected promises. Without a wrapper, EVERY async
 *  controller has to be written like this:
 *
 *      router.get('/', async (req, res, next) => {
 *        try {
 *          const data = await service.list();
 *          res.json(data);
 *        } catch (error) {
 *          next(error);   // forget this line and the request hangs forever
 *        }
 *      });
 *
 *  That is five lines of noise per route, repeated ~60 times, and a single
 *  forgotten `next(error)` produces a request that never responds — the hardest
 *  class of bug to notice, because nothing is logged.
 *
 *  With this wrapper:
 *
 *      router.get('/', asyncHandler(async (req, res) => {
 *        res.json(await service.list());
 *      }));
 *
 *  Any thrown ApiError or unexpected rejection lands in middleware/error.js.
 * =============================================================================
 */

/**
 * @param {(req: import('express').Request,
 *          res: import('express').Response,
 *          next: import('express').NextFunction) => Promise<unknown>} handler
 * @returns {import('express').RequestHandler}
 */
export const asyncHandler = (handler) => (req, res, next) => {
  // Promise.resolve() also tolerates a non-async handler being passed in.
  Promise.resolve(handler(req, res, next)).catch(next);
};

export default asyncHandler;
