import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '@/utils/format';

interface ModalProps {
  open: boolean;
  title?: ReactNode;
  children: ReactNode;
  /** Called on Escape / backdrop click. Omit to make the modal non-dismissable. */
  onClose?: () => void;
  actions?: ReactNode;
  className?: string;
  /** Render inside the nearest positioned ancestor instead of the whole window. */
  contained?: boolean;
}

export function Modal({
  open,
  title,
  children,
  onClose,
  actions,
  className,
  contained,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        '[data-autofocus], button, input',
      );
      target?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
      }
      if (e.key === 'Tab' && panelRef.current) {
        const items = [
          ...panelRef.current.querySelectorAll<HTMLElement>(
            'button, input, select, [tabindex="0"]',
          ),
        ].filter((el) => !el.hasAttribute('disabled'));
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={cx(
            contained ? 'absolute' : 'fixed',
            'inset-0 z-50 flex items-center justify-center p-6',
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            className={cx(
              'relative w-full max-w-md rounded-2xl border border-line bg-elev p-6 shadow-2xl',
              className,
            )}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            {title && (
              <h2 id={titleId} className="mb-3 font-display text-xl font-bold tracking-tight">
                {title}
              </h2>
            )}
            <div className="text-sm text-muted">{children}</div>
            {actions && <div className="mt-6 flex flex-wrap justify-end gap-2">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
