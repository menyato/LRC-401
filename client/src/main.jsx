/**
 * =============================================================================
 *  Application entry point
 * =============================================================================
 *  Wires up the four providers every screen depends on. The nesting ORDER
 *  matters: an inner provider can use an outer one, but not the reverse.
 *
 *      BrowserRouter        navigation
 *        QueryClientProvider  server state
 *          AuthProvider       who is signed in  (calls the API, so it needs Query
 *                                                and the api client available)
 *            App              the routes
 * =============================================================================
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import { ThemeProvider } from '@/features/theme/ThemeProvider';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ToastProvider } from '@/components/Toast';
import '@/lib/i18n';
import '@/styles/index.css';

/**
 * TanStack Query configuration.
 *
 * This is what removes the hand-written loading/error/caching code that would
 * otherwise be repeated in every list screen — the single biggest source of
 * duplication in a React app of this shape.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * Data is considered fresh for 30 seconds. Within that window, navigating
       * back to a screen renders instantly from cache with no request — which
       * on a phone at the station is the difference between "instant" and "a
       * spinner every time".
       */
      staleTime: 30_000,

      /**
       * Do NOT refetch every time the window regains focus. The default is on,
       * and on a phone that fires whenever the user switches apps — expensive
       * on mobile data for data that changes a few times a day.
       */
      refetchOnWindowFocus: false,

      retry: (failureCount, error) => {
        // Never retry a request the server deliberately refused. A 403 will be
        // a 403 three times over, and retrying a 422 just repeats the same
        // invalid input.
        const status = error?.status;
        if (status >= 400 && status < 500) return false;

        // Retry genuine network/server failures twice — a station connection
        // drops briefly quite often.
        return failureCount < 2;
      },
    },

    mutations: {
      // Never silently retry a write. Retrying "issue 10 tourniquets" could
      // record the movement twice.
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/*
      Opt in to the two React Router v7 behaviours now, while the app is small.
      Without these flags v6 logs a deprecation warning on every start, and the
      change lands as a surprise at upgrade time instead of today.

        v7_startTransition   – route state updates are wrapped in
                               React.startTransition, so navigating between the
                               lazily-loaded pages does not block the UI thread.
        v7_relativeSplatPath – fixes relative-link resolution inside splat ("*")
                               routes, which the 404 route uses.
    */}
    {/* Outermost, so every provider below it can read the current theme. */}
    <ThemeProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
