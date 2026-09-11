/**
 * PostCSS — runs Tailwind, then Autoprefixer for older mobile browsers.
 * Order matters: Tailwind must generate the CSS before prefixes are added.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
