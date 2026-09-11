/**
 * =============================================================================
 *  API client
 * =============================================================================
 *  Every network call in the app goes through this file. That gives us one
 *  place for:
 *    • attaching the access token,
 *    • transparently refreshing it when it expires,
 *    • unwrapping the `{ data }` envelope, and
 *    • turning API errors into a consistent Error the UI can display.
 *
 *  WHERE THE ACCESS TOKEN LIVES — and why it is not in localStorage
 *  ----------------------------------------------------------------
 *  It is held in a module-level variable: an ordinary JavaScript value that
 *  exists only while the tab is open.
 *
 *  localStorage would survive a refresh (convenient), but ANY successful XSS
 *  can read it with a single line and exfiltrate a working credential. A
 *  variable in a module closure is not reachable that way.
 *
 *  We lose nothing by it: the httpOnly refresh cookie survives the page reload,
 *  so on startup the app calls /auth/refresh once and is signed in again. The
 *  user never notices, and there is no long-lived token sitting in browser
 *  storage.
 * =============================================================================
 */

import axios from 'axios';

/** The in-memory access token. Never persisted. */
let accessToken = null;

/** Called by the auth provider when a refresh finally fails. */
let onAuthFailure = () => {};

export const setAccessToken = (token) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

export const setAuthFailureHandler = (handler) => {
  onAuthFailure = handler;
};

export const api = axios.create({
  // Relative: Vite proxies /api to the backend in development, and in
  // production the app is served behind the same domain. No environment
  // variable to forget when deploying.
  baseURL: '/api',
  // Required for the httpOnly refresh cookie to be sent.
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  // A slow mobile connection at the station is normal; a hang is not.
  timeout: 20_000,
});

// -----------------------------------------------------------------------------
//  Request: attach the token
// -----------------------------------------------------------------------------
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// -----------------------------------------------------------------------------
//  Response: refresh once on 401, then retry
// -----------------------------------------------------------------------------

/**
 * Guards against a refresh stampede.
 *
 * A dashboard fires several requests at once. When the token expires they ALL
 * get 401 together. Without this, each would trigger its own /auth/refresh —
 * and because refresh tokens ROTATE, the second call would present a token the
 * first had just consumed, which the server correctly reads as theft and
 * responds to by killing every session.
 *
 * So: the first 401 starts a refresh, and everyone else waits on that same
 * promise.
 */
let refreshPromise = null;

async function refreshAccessToken() {
  // Bare axios, not `api`: using the instance would recurse through this very
  // interceptor if the refresh itself returned 401.
  const response = await axios.post('/api/auth/refresh', null, { withCredentials: true });
  const token = response.data?.data?.accessToken;

  if (!token) throw new Error('No access token in refresh response');

  setAccessToken(token);
  return token;
}

api.interceptors.response.use(
  (response) => response,

  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;

    // Only attempt a refresh for an EXPIRED token, and only once per request.
    // Retrying on every 401 would loop forever against a genuinely invalid
    // session, and retrying a 403 would be pointless — the user is signed in,
    // they simply are not allowed.
    const isExpiredToken = status === 401 && ['TOKEN_EXPIRED', 'NO_TOKEN'].includes(code);
    const isRefreshCall = original?.url?.includes('/auth/refresh');

    if (isExpiredToken && !original._retried && !isRefreshCall) {
      original._retried = true;

      try {
        refreshPromise = refreshPromise ?? refreshAccessToken();
        const token = await refreshPromise;

        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch (refreshError) {
        // The refresh token is gone, expired or was reused. Nothing more to do
        // but send the user to the login screen.
        setAccessToken(null);
        onAuthFailure();
        return Promise.reject(normalizeError(refreshError));
      } finally {
        // Cleared whether we succeeded or failed, so the NEXT expiry starts a
        // fresh attempt rather than reusing a settled promise.
        refreshPromise = null;
      }
    }

    return Promise.reject(normalizeError(error));
  },
);

/**
 * Converts any axios failure into a predictable Error.
 *
 * Components can then always read `error.message`, `error.code` and
 * `error.details` without knowing whether the failure came from the server, the
 * network, or a timeout.
 */
function normalizeError(error) {
  // The server answered with our standard error envelope.
  if (error.response?.data?.error) {
    const { message, code, details } = error.response.data.error;

    const normalized = new Error(message ?? 'Something went wrong');
    normalized.code = code;
    normalized.details = details;
    normalized.status = error.response.status;
    return normalized;
  }

  // Request was made but nothing came back — offline, server down, DNS.
  if (error.request) {
    const normalized = new Error(
      'Cannot reach the server. Check your connection and try again.',
    );
    normalized.code = 'NETWORK_ERROR';
    return normalized;
  }

  return error;
}

// -----------------------------------------------------------------------------
//  Convenience wrappers
// -----------------------------------------------------------------------------
//  The API always answers with `{ data }` (and `{ data, meta }` for lists).
//  These unwrap it so a component writes `const items = await get('/inventory/items')`
//  instead of `response.data.data`.
// -----------------------------------------------------------------------------

/** Returns the `data` payload. */
export const get = async (url, config) => (await api.get(url, config)).data.data;

/** Returns the FULL envelope, so `meta` (pagination) is available. */
export const getPaged = async (url, config) => (await api.get(url, config)).data;

export const post = async (url, body, config) => (await api.post(url, body, config)).data.data;
export const patch = async (url, body, config) => (await api.patch(url, body, config)).data.data;
export const put = async (url, body, config) => (await api.put(url, body, config)).data.data;
export const del = async (url, config) => (await api.delete(url, config)).data;

export default api;
