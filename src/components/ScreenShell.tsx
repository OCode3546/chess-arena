import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from './ui';

interface ScreenShellProps {
  id: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}

/** Standard page frame: back button, heading, scrollable content. */
export function ScreenShell({ id, title, subtitle, children, actions }: ScreenShellProps) {
  const navigate = useNavigate();
  return (
    <motion.section
      data-screen={id}
      className="flex h-full flex-col overflow-y-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')} aria-label="Back to home">
            ← Home
          </Button>
          <div className="flex-1">
            <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions}
        </div>
        {children}
      </div>
    </motion.section>
  );
}
