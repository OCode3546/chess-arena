import { pieceUrl } from '@/config/pieces';
import { useSettings } from '@/store/settingsStore';
import { cx } from '@/utils/format';
import { useWindowState } from './useWindowState';

function WinButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'no-drag flex h-full w-12 cursor-pointer items-center justify-center text-muted transition-colors',
        danger ? 'hover:bg-[#e81123] hover:text-white' : 'hover:bg-surface-2 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const state = useWindowState();
  const theme = useSettings((s) => s.settings.theme);
  const update = useSettings((s) => s.update);
  const win = window.chessArena.window;

  if (state.fullscreen) return null;

  return (
    <header
      className="drag-region relative z-40 flex h-10 shrink-0 items-center border-b border-line bg-bg/60 backdrop-blur"
      onDoubleClick={() => win.toggleMaximize()}
    >
      <div className="flex items-center gap-2 pl-4">
        <Logo className="h-5 w-5" />
        <span className="font-display text-sm font-bold tracking-tight">Chess Arena</span>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => update({ theme: theme === 'dark' ? 'light' : 'dark' })}
        onDoubleClick={(e) => e.stopPropagation()}
        className="no-drag mr-2 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        title="Toggle theme"
      >
        {theme === 'dark' ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>
      <div className="flex h-full" onDoubleClick={(e) => e.stopPropagation()}>
        <WinButton label="Minimize" onClick={() => win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M0 5h10" stroke="currentColor" />
          </svg>
        </WinButton>
        <WinButton
          label={state.maximized ? 'Restore' : 'Maximize'}
          onClick={() => win.toggleMaximize()}
        >
          {state.maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
              <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
              <path d="M.5.5h9v9h-9z" />
            </svg>
          )}
        </WinButton>
        <WinButton label="Close" danger onClick={() => win.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor">
            <path d="M0 0l10 10M10 0L0 10" />
          </svg>
        </WinButton>
      </div>
    </header>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'flex items-center justify-center rounded-[28%] bg-gradient-to-br from-accent-soft to-accent',
        className,
      )}
      aria-hidden
    >
      <img
        src={pieceUrl('modern', 'w', 'n')}
        alt=""
        draggable={false}
        className="h-[78%] w-[78%]"
      />
    </span>
  );
}
