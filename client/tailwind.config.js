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

          /**
           * Theme-aware members of the brand family, for the "selected" chip:
           * an active nav item, a chosen radio card, the logo badge.
           *
           * `subtle` is the tinted GROUND and `strong` the text on it. They
           * are separate from the numbered scale because that scale must stay
           * fixed — brand-600 is the official LRC red in both themes — while a
           * tint used as a background has to flip to deep maroon in the dark,
           * and its text has to go light.
           */
          subtle: 'rgb(var(--brand-subtle) / <alpha-value>)',
          strong: 'rgb(var(--brand-strong) / <alpha-value>)',
        },

        /**
         * Status palette for the equipment reports.
         *
         * Deliberately NOT the brand red: on a page where the header is red, a
         * red badge would not read as an alert. Critical uses a deeper, more
         * saturated red that stands apart from the branding.
         *
         * These resolve through CSS variables, so the dark theme substitutes
         * lighter, less saturated values automatically — the opposite
         * adjustment from what feels intuitive, but the one that stays legible
         * on a dark ground. A `text-status-critical` written once is correct in
         * both themes; there is no `statusDark` to remember to use.
         */
        status: {
          ok: 'rgb(var(--status-ok) / <alpha-value>)',
          okBg: 'rgb(var(--status-ok-bg) / <alpha-value>)',
          warn: 'rgb(var(--status-warn) / <alpha-value>)',
          warnBg: 'rgb(var(--status-warn-bg) / <alpha-value>)',
          critical: 'rgb(var(--status-critical) / <alpha-value>)',
          criticalBg: 'rgb(var(--status-critical-bg) / <alpha-value>)',
          missing: 'rgb(var(--status-missing) / <alpha-value>)',
          missingBg: 'rgb(var(--status-missing-bg) / <alpha-value>)',
        },

        /**
         * Neutral surfaces.
         *
         *   surface          a card, a modal, a table row
         *   surface-muted    the page BEHIND the cards
         *   surface-elevated a popover sitting above a card
         *   surface-border   the line between them
         *
         * Three distinct steps, not two. The original light palette had the
         * page at #fafaf9 and cards at #ffffff — a 1.3% difference in
         * lightness, invisible on a phone in daylight, which is exactly where
         * this app is used. Cards, tables and modals blurred into one flat
         * sheet. The page ground is now a full step darker.
         */
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          muted: 'rgb(var(--surface-muted) / <alpha-value>)',
          elevated: 'rgb(var(--surface-elevated) / <alpha-value>)',
          border: 'rgb(var(--surface-border) / <alpha-value>)',
        },

        /**
         * THE NEUTRAL SCALE IS OVERRIDDEN ON PURPOSE.
         *
         * Tailwind ships `stone` as fixed hex values. Here it points at CSS
         * variables that INVERT in dark mode: stone-50 is near-white in light
         * and near-black in dark, stone-900 the reverse.
         *
         * That inversion is what makes the whole app theme-aware. A component
         * written as `bg-white text-stone-900 border-surface-border` — the
         * natural way to write it — becomes near-black with near-white text in
         * dark mode without being edited. Thirty components had no dark
         * support at all, which is why dark mode appeared to affect only the
         * login card and not the page behind it; they are all fixed by this,
         * and so is the next component somebody writes.
         *
         * Trade-off, stated plainly: `stone` no longer means the Tailwind
         * colour of that name. Anywhere a genuinely fixed grey is needed
         * regardless of theme — print styles, a colour swatch — use `zinc` or
         * `neutral`, which are untouched.
         */
        stone: {
          50: 'rgb(var(--stone-50) / <alpha-value>)',
          100: 'rgb(var(--stone-100) / <alpha-value>)',
          200: 'rgb(var(--stone-200) / <alpha-value>)',
          300: 'rgb(var(--stone-300) / <alpha-value>)',
          400: 'rgb(var(--stone-400) / <alpha-value>)',
          500: 'rgb(var(--stone-500) / <alpha-value>)',
          600: 'rgb(var(--stone-600) / <alpha-value>)',
          700: 'rgb(var(--stone-700) / <alpha-value>)',
          800: 'rgb(var(--stone-800) / <alpha-value>)',
          900: 'rgb(var(--stone-900) / <alpha-value>)',
          950: 'rgb(var(--stone-950) / <alpha-value>)',
        },

        /**
         * `white` follows the theme too.
         *
         * `bg-white` is the single most common class in the codebase and the
         * most common reason a panel stayed blazing white in dark mode. It now
         * means "the card surface", which is what every use of it actually
         * meant. For genuinely, permanently white — the text on the red header
         * bar, which sits on brand-600 in both themes — use `text-pure-white`.
         */
        white: 'rgb(var(--surface) / <alpha-value>)',

        /**
         * Solid destructive-button fill — see `.btn-danger` in index.css.
         * Separate from `status-critical` because that token LIGHTENS in dark
         * mode (so it stays readable as text on a dark ground), which would
         * leave white-on-light-red at about 2.5:1 as a button fill.
         */
        danger: {
          solid: 'rgb(var(--danger-solid) / <alpha-value>)',
        },

        /**
         * Input placeholder — see the note in index.css. Named rather than
         * reusing `stone-400`, which is legible in dark mode but only 2.52:1
         * on white.
         */
        placeholder: 'rgb(var(--placeholder) / <alpha-value>)',
        pure: {
          white: '#ffffff',
          black: '#000000',
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
        /*
          Strengthened from 0.06 alpha. With the page ground darkened to
          separate cards properly, the old shadow was too faint to add any
          lift on top of it. Dark mode drops the shadow entirely and relies on
          the border — shadows are invisible against a dark ground.
        */
        card: '0 1px 3px 0 rgb(0 0 0 / 0.10), 0 1px 2px -1px rgb(0 0 0 / 0.08)',
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
