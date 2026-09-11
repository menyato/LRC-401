/**
 * =============================================================================
 *  Modal dialog
 * =============================================================================
 *  Built on the native <dialog> element rather than a hand-rolled overlay.
 *  The browser then gives us, for free and correctly:
 *    • focus trapping (Tab cannot escape the dialog)
 *    • Escape to close
 *    • the top layer, so nothing can accidentally overlap it
 *    • `aria-modal` semantics for screen readers
 *
 *  Getting those right by hand is where most custom modals fail accessibility.
 * =============================================================================
 */

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * @param {object} props
 * @param {boolean}  props.isOpen
 * @param {Function} props.onClose
 * @param {string}   props.title
 * @param {'sm'|'md'|'lg'|'xl'} [props.size]
 * @param {React.ReactNode} [props.footer]  Action buttons.
 */
export function Modal({ isOpen, onClose, title, size = 'md', children, footer }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      // showModal() (not show()) is what activates the top layer, the backdrop
      // and the focus trap.
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // The browser fires `close` for Escape too, so routing it back to onClose
    // keeps React state in sync with what the user actually sees.
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);

    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const widths = {
    sm: 'sm:max-w-sm',
    md: 'sm:max-w-lg',
    lg: 'sm:max-w-2xl',
    xl: 'sm:max-w-4xl',
  };

  return (
    <dialog
      ref={dialogRef}
      // `backdrop:` styles the ::backdrop pseudo-element the browser provides.
      className={`w-full rounded-none p-0 backdrop:bg-black/40 sm:rounded-card ${widths[size]}
                  m-0 max-h-full h-full sm:m-auto sm:h-auto sm:max-h-[90vh]`}
      onClick={(event) => {
        // Clicking the backdrop closes. The click lands on the <dialog> itself
        // only when it is outside the content box, so comparing the target to
        // the dialog is the standard way to detect it.
        if (event.target === dialogRef.current) onClose();
      }}
      aria-labelledby="modal-title"
    >
      {/* Full height on mobile so the dialog behaves like a page, not a card. */}
      <div className="flex h-full flex-col bg-white sm:max-h-[90vh]">
        <header className="flex items-center justify-between gap-3 border-b border-surface-border px-4 py-3">
          <h2 id="modal-title" className="text-base font-semibold text-stone-900">
            {title}
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* The body scrolls, so the header and footer stay reachable. */}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {footer && (
          <footer className="flex justify-end gap-2 border-t border-surface-border px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

/**
 * Confirmation before a destructive or irreversible action.
 *
 * Used for suspending an account, cancelling an invitation, deactivating an
 * item — anything a person would regret doing by a mis-tap.
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  isDanger = true,
  isPending = false,
}) {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={isDanger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? t('common.saving') : (confirmLabel ?? t('common.confirm'))}
          </button>
        </>
      }
    >
      <p className="text-sm text-stone-600">{message}</p>
    </Modal>
  );
}

export default Modal;
