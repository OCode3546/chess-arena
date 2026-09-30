import { motion } from 'framer-motion';
import { Logo } from '@/app/TitleBar';

export function SplashScreen() {
  return (
    <motion.div
      data-screen="splash"
      className="flex h-full flex-col items-center justify-center gap-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02 }}
    >
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Logo className="h-20 w-20 shadow-2xl" />
      </motion.div>
      <div className="font-display text-3xl font-bold tracking-tight">Chess Arena</div>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-surface-2">
        <motion.div
          className="h-full w-1/3 rounded-full bg-accent-soft"
          animate={{ x: ['-100%', '300%'] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      <span className="sr-only">Loading…</span>
    </motion.div>
  );
}
