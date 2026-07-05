import { useEffect, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Style the confirm action as destructive (red). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * In-app replacement for window.confirm(): a small centered modal that renders
 * above the bottom sheets. Backdrop tap and Escape both cancel; the confirm
 * button takes initial focus. Used for the "discard this?" close guards.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Keep editing',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <>
      <div className="cd-backdrop" onClick={onCancel} />
      <div className="cd-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3 className="cd-title">{title}</h3>
        {message && <p className="cd-message">{message}</p>}
        <div className="cd-actions">
          <button className="btn btn-ghost cd-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            className={`btn cd-btn ${danger ? 'cd-confirm-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
