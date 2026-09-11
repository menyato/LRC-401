/**
 * =============================================================================
 *  Tailwind configuration — the LRC design system
 * =============================================================================
 *  Every colour, radius and shadow the app uses is declared here. Components
 *  reference the NAMES (`bg-brand-600`, `text-status-critical`), never raw hex
 *  values. That means restyling the whole application — a different red, a
 *  darker surface — is an edit to this one file.
 *
 *  ACCESSIBILITY NOTE: the status colours are chosen so that critical/warning/
 *  ok are distinguishable by more than hue. Every status in the UI is ALSO
 *  labelled with text and an icon, because roughly 1 in 12 men has some form of
 *  red-green colour blindness, and this is an application where "is this red?"
 *  decides whether an ambulance goes out short of equipment.
 * =============================================================================
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],

  /**
   * Dark mode is driven by a `dark` class on <html>, not by the OS setting
   * alone.
   *
   * The station works day and night shifts in very different light: a bright
   * garage at noon, a dim ER room at 3am. People need to be able to CHOOSE,
   * and their choice must survive a reload. The ThemeProvider still defaults to
   * the OS preference — it just does not force it.
   */
  darkMode: 'class',

  theme: {
    extend: {
      colors: {
        /**
         * Lebanese Red Cross red. 600 is the official brand tone; the lighter
         * and darker steps are for hovers, borders and tinted backgrounds.
         */
        brand: {
          50: '#fef2f3',
          100: '#fde3e5',
          200: '#fbccd0',
          300: '#f7a5ab',
          400: '#f27380',
          500: '#e8455a',
          600: '#ED1B2E', // ← official LRC red
          700: '#c11626',
          800: '#a11624',
          900: '#881824',
          950: '#4b070f',
        },

        /**
         * Status palette for the equipment reports.
         * Deliberately NOT the brand red: on a page where the header is red,
         * a red badge would not read as an alert. Critical uses a deeper,
         * more saturated red that stands apart from the branding.
         */
        status: {
          ok: '#15803d',
          okBg: '#f0fdf4',
          warn: '#b45309',
          warnBg: '#fffbeb',
          critical: '#b91c1c',
          criticalBg: '#fef2f2',
          missing: '#52525b',
          missingBg: '#fafafa',
        },

        /** Neutral surfaces. Warm greys sit better against red than blue-greys. */
        surface: {
          DEFAULT: '#ffffff',
          muted: '#fafaf9',
          border: '#e7e5e4',

          /**
           * Dark counterparts.
           *
           * Warm near-blacks rather than pure #000: an OLED phone at night is
           * genuinely uncomfortable against pure black, and the red brand
           * colour vibrates badly on it. These are the same warm stone family
           * as the light surfaces, simply inverted.
           */
          dark: '#1c1917',
          darkMuted: '#0c0a09',
          darkElevated: '#292524',
          darkBorder: '#44403c',
        },

        /**
         * Status colours that stay legible on a dark ground.
         *
         * The light-mode versions are deep and saturated so they read against
         * white; on a dark surface those same values disappear. These are
         * lighter and less saturated, which is the opposite adjustment from
         * what feels intuitive but is what actually works.
         */
        statusDark: {
          ok: '#4ade80',
          okBg: '#052e16',
          warn: '#fbbf24',
          warnBg: '#292524',
          critical: '#f87171',
          criticalBg: '#450a0a',
          missing: '#a8a29e',
          missingBg: '#1c1917',
        },
      },

      fontFamily: {
        /**
         * The stack starts with the system UI font so the app looks native on
         * each device and loads instantly. Arabic falls back to fonts that are
         * already installed everywhere, so no webfont download is needed for
         * the Arabic interface — important on a slow connection.
         */
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Noto Sans Arabic',
          'Segoe UI Arabic',
          'Arial',
          'sans-serif',
        ],
      },

      borderRadius: {
        card: '0.75rem',
      },

      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        popover: '0 10px 30px -10px rgb(0 0 0 / 0.2)',
      },

      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },

      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
      },
    },
  },

  plugins: [],
};
