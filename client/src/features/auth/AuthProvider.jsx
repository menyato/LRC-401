/**
 * =============================================================================
 *  Authentication provider
 * =============================================================================
 *  Holds the signed-in user, their resolved permissions, and the login /
 *  logout actions. Everything else in the app reads it through `useAuth()`.
 *
 *  IMPORTANT — the permissions here are for RENDERING ONLY.
 *  `can('inventory.item:create')` decides whether to show a button. It is not
 *  security: the server enforces the same permission on every endpoint. A user
 *  who edits this state in their browser gains a button that returns 403.
 *  Never move an authorisation decision into this file.
 * =============================================================================
 */

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { post, get, setAccessToken, setAuthFailureHandler } from '@/lib/api';

const AuthContext = createContext(null);

/**
 * =============================================================================
 *  The session hint
 * =============================================================================
 *  A flag saying "this browser probably has a valid refresh cookie".
 *
 *  WHY IT EXISTS
 *
 *  The refresh token is an httpOnly cookie, which is exactly what makes it safe
 *  — JavaScript cannot read it, so an XSS hole cannot steal it. The cost is
 *  that the app also cannot ASK whether it has one. So on every first visit it
 *  fired `POST /auth/refresh` blind, and for a signed-out visitor that is a
 *  guaranteed 401: a red error in the console of anyone who opens the login
 *  page, and a request against the refresh rate limiter before they have even
 *  typed anything.
 *
 *  This flag is the readable half of that pair. It carries NO authority and is
 *  not a credential — a user can set it by hand and gain nothing, because the
 *  cookie is still what the server checks. It only answers "is it worth
 *  asking?".
 *
 *  It deliberately fails OPEN: if localStorage is unavailable (private mode,
 *  site data blocked) every read returns true and we attempt the refresh as
 *  before. A noisy console is a much smaller problem than a user who cannot be
 *  signed back in.
 * =============================================================================
 */
const SESSION_HINT_KEY = 'lrc-session';

function hasSessionHint() {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    // Storage blocked — assume a session might exist and let the server decide.
    return true;
  }
}

function setSessionHint(present) {
  try {
    if (present) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Nothing to do. The hint is an optimisation, never a requirement.
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [teams, setTeams] = useState({ adminOf: [], memberOf: [], supervisesAll: false });
  const [permissionCatalogue, setPermissionCatalogue] = useState([]);

  /**
   * True until the initial "am I already signed in?" check finishes.
   * Without it, the app would flash the login screen on every page refresh
   * before the silent refresh completes.
   */
  const [isInitialising, setIsInitialising] = useState(true);

  /** Guards the startup effect against StrictMode's double invocation. */
  const bootstrapped = useRef(false);

  /** Applies a /auth/me response to state. */
  const applySession = useCallback((payload) => {
    setUser(payload.user);
    setPermissions(payload.permissions ?? []);
    setTeams(payload.teams ?? { adminOf: [], memberOf: [], supervisesAll: false });
    setPermissionCatalogue(payload.permissionCatalogue ?? []);
  }, []);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setPermissions([]);
    setTeams({ adminOf: [], memberOf: [] });
    // Whatever ended the session — logout, an expired cookie, a failed refresh
    // mid-session — the next page load should not ask again.
    setSessionHint(false);
  }, []);

  // ---------------------------------------------------------------------------
  //  Startup: try to restore the session
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Lets the api layer drop us back to signed-out when a refresh finally fails
    // mid-session, without importing React state into a plain module.
    setAuthFailureHandler(clearSession);

    // React StrictMode runs effects twice in development. Without this guard
    // that is two refresh calls per load — which is what put a PAIR of 401s in
    // the console, and what tripped the refresh rate limiter after a dozen
    // reloads.
    if (bootstrapped.current) return undefined;
    bootstrapped.current = true;

    // No hint means no cookie worth trying. Skip straight to signed-out
    // instead of firing a request that can only 401.
    if (!hasSessionHint()) {
      setIsInitialising(false);
      return undefined;
    }

    (async () => {
      try {
        // The access token lives in memory and is gone after a reload, but the
        // httpOnly refresh cookie is not — so this silently signs the user back
        // in. A 401 here still simply means "not signed in": the hint can be
        // stale, because the cookie can expire while the flag stays behind.
        const { accessToken } = await post('/auth/refresh');
        setAccessToken(accessToken);

        applySession(await get('/auth/me'));
        setSessionHint(true);
      } catch {
        clearSession();
      } finally {
        setIsInitialising(false);
      }
    })();

    return undefined;
  }, [applySession, clearSession]);

  // ---------------------------------------------------------------------------
  //  Actions
  // ---------------------------------------------------------------------------

  /**
   * Step 1 of signing in.
   *
   * @returns {Promise<{requiresTwoFactor: boolean, mfaToken?: string}>}
   *          When `requiresTwoFactor` is true the caller must show the code
   *          screen and then call `verifyTwoFactor` — the user is NOT signed in
   *          yet, and nothing here has been stored.
   */
  const login = useCallback(
    async (credentials) => {
      const result = await post('/auth/login', credentials);

      if (result.requiresTwoFactor) {
        return { requiresTwoFactor: true, mfaToken: result.mfaToken };
      }

      setAccessToken(result.accessToken);
      applySession(await get('/auth/me'));
      setSessionHint(true);

      return { requiresTwoFactor: false };
    },
    [applySession],
  );

  /** Step 2: the 6-digit code, or a backup code. */
  const verifyTwoFactor = useCallback(
    async ({ mfaToken, code, isBackupCode = false }) => {
      const result = await post('/auth/verify-2fa', { mfaToken, code, isBackupCode });

      setAccessToken(result.accessToken);
      applySession(await get('/auth/me'));
      setSessionHint(true);
    },
    [applySession],
  );

  /** Used after accepting an invitation, which signs the user straight in. */
  const applyDirectSession = useCallback(
    async (accessToken) => {
      setAccessToken(accessToken);
      applySession(await get('/auth/me'));
      setSessionHint(true);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } catch {
      // Ignore: the local session must be cleared even if the server call fails
      // (offline, already expired). Leaving the user "signed in" on a broken
      // logout is the worse outcome.
    } finally {
      clearSession();
    }
  }, [clearSession]);

  /** Re-reads /auth/me — call after a change to the user's own profile. */
  const refreshUser = useCallback(async () => {
    applySession(await get('/auth/me'));
  }, [applySession]);

  // ---------------------------------------------------------------------------
  //  Permission helpers
  // ---------------------------------------------------------------------------

  /** @param {string} permission @returns {boolean} */
  const can = useCallback(
    (permission) => {
      if (!user) return false;
      // Mirrors the server's rule: the super admin can do everything.
      if (user.isSuperAdmin) return true;
      return permissions.includes(permission);
    },
    [user, permissions],
  );

  const canAny = useCallback(
    (list) => list.some((permission) => can(permission)),
    [can],
  );

  const value = useMemo(
    () => ({
      user,
      permissions,
      permissionCatalogue,
      teams,
      isAuthenticated: Boolean(user),
      isInitialising,
      isSuperAdmin: Boolean(user?.isSuperAdmin),
      login,
      verifyTwoFactor,
      applyDirectSession,
      logout,
      refreshUser,
      can,
      canAny,
    }),
    [
      user,
      permissions,
      permissionCatalogue,
      teams,
      isInitialising,
      login,
      verifyTwoFactor,
      applyDirectSession,
      logout,
      refreshUser,
      can,
      canAny,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * @throws when used outside <AuthProvider>. A loud error at development time is
 * far better than a confusing "cannot read property user of null" later.
 */
export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }

  return context;
}
