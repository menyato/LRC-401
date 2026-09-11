/**
 * =============================================================================
 *  Toast notifications
 * =============================================================================
 *  A small, dependency-free notification system. Used for the short
 *  confirmations that follow an action — "Draft saved", "Invitation sent",
 *  "Not enough stock".
 *
 *  Why not a library? This is ~120 lines, has no styling to fight with, and
 *  keeps the bundle smaller — which matters on the mobile connections this app
 *  runs on.
 *
 *  Usage:
 *      const toast = useToast();
 *      toast.success('Draft saved');
 *      toast.error(error.message);
 * =============================================================================
 */

import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

const ToastContext = createContext(null);

/** How long each kind stays on screen. Errors linger — they need to be read. */
const DURATIONS = { success: 3000, info: 3000, warning: 5000, error: 6000 };

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'bg-status-okBg text-status-ok border-status-ok/20',
  error: 'bg-status-criticalBg text-status-critical border-status-critical/20',
  warning: 'bg-status-warnBg text-status-warn border-status-warn/20',
  info: 'bg-white text-stone-700 border-surface-border',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message, type = 'info') => {
      // crypto.randomUUID is available in every browser this app targets and
      // avoids the duplicate-key bug a counter would hit after a remount.
      const id = crypto.randomUUID();

      setToasts((current) => [...current, { id, message, type }]);
      setTimeout(() => dismiss(id), DURATIONS[type]);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      show,
      success: (message) => show(message, 'success'),
      error: (message) => show(message, 'error'),
      warning: (message) => show(message, 'warning'),
      info: (message) => show(message, 'info'),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/*
        Fixed to the bottom on mobile (near the thumb, away from the header) and
        to the top-right on desktop. `pointer-events-none` on the container so
        toasts never block a click on the page beneath; the toasts themselves
        re-enable it for their dismiss button.
      */}
      <div
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2
                   sm:inset-x-auto sm:bottom-auto sm:end-4 sm:top-20 sm:w-96"
        // Announces new toasts to screen readers without stealing focus.
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto flex items-start gap-3 rounded-lg border p-3
                          shadow-popover animate-slide-up ${STYLES[toast.type]}`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="flex-1 text-sm leading-snug">{toast.message}</p>

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used inside <ToastProvider>');
  }

  return context;
}
