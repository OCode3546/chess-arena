import { AnimatePresence, motion } from 'framer-motion';
import { useToasts, type ToastKind } from '@/store/toastStore';
import { cx } from '@/utils/format';

const TONE: Record<ToastKind, string> = {
  info: 'border-l-accent-soft',
  success: 'border-l-success',
  warning: 'border-l-warning',
  error: 'border-l-danger',
};

export function ToastHost() {
  const { toasts, dismiss } = useToasts();
  return (
    <div
      className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-80 flex-col gap-2"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            role={t.kind === 'error' || t.kind === 'warning' ? 'alert' : 'status'}
            className={cx(
              'pointer-events-auto flex items-start gap-3 rounded-xl border border-l-4 border-line bg-elev px-4 py-3 text-sm text-fg shadow-xl',
              TONE[t.kind],
            )}
          >
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="cursor-pointer text-muted hover:text-fg"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
