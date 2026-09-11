/**
 * =============================================================================
 *  useDebounced
 * =============================================================================
 *  Returns a value that only updates after it has stopped changing for `delay`
 *  milliseconds.
 *
 *  Used for search boxes: typing "tourniquet" would otherwise fire ten requests
 *  in under a second. Beyond the wasted bandwidth, the responses can arrive out
 *  of order on a slow connection and leave the results for "tourni" on screen
 *  after those for the full word.
 * =============================================================================
 */

import { useState, useEffect } from 'react';

/**
 * @template T
 * @param {T} value
 * @param {number} [delay=300]
 * @returns {T}
 */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);

    // Cleanup runs before the next effect, so each keystroke cancels the
    // previous timer. That is the whole mechanism — without the clear, every
    // keystroke would simply fire `delay` ms later.
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebounced;
