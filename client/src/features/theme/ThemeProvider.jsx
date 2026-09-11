/**
 * =============================================================================
 *  Theme — light, dark, or follow the device
 * =============================================================================
 *  THREE states, not two. "Dark" and "light" are explicit choices; "system"
 *  follows the device and changes with it.
 *
 *  That third state matters here. A phone set to switch at sunset will follow
 *  the shift pattern on its own — which is what most people want — but somebody
 *  working under bright garage lights at night needs to be able to override it
 *  and have that stick.
 *
 *  APPLIED BEFORE FIRST PAINT. A small script in index.html reads the saved
 *  preference and sets the class on <html> synchronously, so the page never
 *  flashes white before React loads. This provider then takes over.
 * =============================================================================
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'lrc-theme';

const ThemeContext = createContext(null);

/** Reads the stored preference, tolerating a blocked or empty localStorage. */
function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private browsing, or storage disabled. The default is fine.
  }

  return 'system';
}

/** Turns a preference into the class that should be on <html>. */
function resolve(theme) {
  if (theme === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme);
  const [resolved, setResolved] = useState(() => resolve(readStoredTheme()));

  // --- Apply to the document ------------------------------------------------
  useEffect(() => {
    const applied = resolve(theme);
    setResolved(applied);

    const root = document.documentElement;
    root.classList.toggle('dark', applied === 'dark');

    // Tells the browser to render native controls (scrollbars, form fields,
    // the address bar on mobile) to match. Without it a dark page keeps white
    // scrollbars, which looks broken rather than dark.
    root.style.colorScheme = applied;

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not fatal — the choice simply will not survive a reload.
    }
  }, [theme]);

  // --- Follow the device while on "system" ----------------------------------
  useEffect(() => {
    if (theme !== 'system') return undefined;

    const query = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = () => {
      const applied = query.matches ? 'dark' : 'light';
      setResolved(applied);
      document.documentElement.classList.toggle('dark', applied === 'dark');
      document.documentElement.style.colorScheme = applied;
    };

    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [theme]);

  const value = useMemo(
    () => ({
      /** 'light' | 'dark' | 'system' — what the user chose. */
      theme,
      /** 'light' | 'dark' — what is actually on screen right now. */
      resolved,
      setTheme: setThemeState,
      /**
       * Cycles light → dark → system. One control rather than three, because
       * the header has little room and this is not a setting people change
       * often enough to deserve a segmented control.
       */
      cycleTheme: () =>
        setThemeState((current) =>
          current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light',
        ),
    }),
    [theme, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }

  return context;
}

export default ThemeProvider;
