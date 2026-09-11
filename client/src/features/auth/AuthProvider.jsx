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

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { post, get, setAccessToken, setAuthFailureHandler } from '@/lib/api';

const AuthContext = createContext(null);

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
  }, []);

  // ---------------------------------------------------------------------------
  //  Startup: try to restore the session
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Lets the api layer drop us back to signed-out when a refresh finally fails
    // mid-session, without importing React state into a plain module.
    setAuthFailureHandler(clearSession);

    (async () => {
      try {
        // The access token lives in memory and is gone after a reload, but the
        // httpOnly refresh cookie is not — so this silently signs the user back
        // in. A 401 here simply means "not signed in", which is not an error.
        const { accessToken } = await post('/auth/refresh');
        setAccessToken(accessToken);

        applySession(await get('/auth/me'));
      } catch {
        clearSession();
      } finally {
        setIsInitialising(false);
      }
    })();
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
    },
    [applySession],
  );

  /** Used after accepting an invitation, which signs the user straight in. */
  const applyDirectSession = useCallback(
    async (accessToken) => {
      setAccessToken(accessToken);
      applySession(await get('/auth/me'));
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
