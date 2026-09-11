/**
 * =============================================================================
 *  Logo mark — the official Lebanese Red Cross roundel
 * =============================================================================
 *  Uses the real asset supplied by the station
 *  (`src/assets/LRC-LOGO.png`) rather than a drawn approximation.
 *
 *  ON THE EMBLEM: the red cross on a white ground is protected under the Geneva
 *  Conventions and Lebanese law. It is used here as the National Society's own
 *  mark, in the Society's own internal tool, which is precisely the permitted
 *  use. It should not be copied out of this project into anything else.
 *
 *  WHY A PLAIN <img> AND NOT AN INLINE SVG: the artwork is a raster roundel
 *  with fine lettering around its edge. Vite fingerprints and caches it, and the
 *  browser scales it far better than inlining a large base64 blob into every
 *  page would.
 * =============================================================================
 */

import logoUrl from '@/assets/LRC-LOGO.png';

/**
 * @param {object} props
 * @param {string} [props.className]
 * @param {boolean} [props.decorative]  When false, the logo is announced to
 *                                      screen readers. Default true, because
 *                                      the station name is almost always
 *                                      written next to it in text already.
 */
export function LrcLogo({ className = 'h-8 w-8', decorative = true }) {
  return (
    <img
      src={logoUrl}
      className={`${className} select-none object-contain`}
      // The roundel is a circle on a transparent ground, so it sits correctly on
      // the red header and on a dark surface without needing a white plate.
      alt={decorative ? '' : 'Lebanese Red Cross'}
      aria-hidden={decorative ? 'true' : undefined}
      draggable="false"
      // Shown in the header on every page, so it must never be the thing that
      // delays first paint.
      loading="eager"
      decoding="async"
    />
  );
}

export default LrcLogo;
