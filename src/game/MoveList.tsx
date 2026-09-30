import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui';
import { useGameStore } from '@/store/gameStore';
import { cx } from '@/utils/format';

export function MoveList({ className }: { className?: string }) {
  const history = useGameStore((s) => s.history);
  const viewPly = useGameStore((s) => s.viewPly);
  const setViewPly = useGameStore((s) => s.setViewPly);
  const activeRef = useRef<HTMLButtonElement>(null);
  const current = viewPly ?? history.length;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const rows = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push(
      <li
        key={i}
        className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-1 px-2 py-0.5 odd:bg-surface/60"
      >
        <span className="text-xs tabular-nums text-muted">{i / 2 + 1}.</span>
        {[i, i + 1].map((idx) => {
          const m = history[idx];
          if (!m) return <span key={idx} />;
          const ply = idx + 1;
          const active = ply === current;
          return (
            <button
              key={idx}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => setViewPly(ply)}
              aria-current={active ? 'step' : undefined}
              className={cx(
                'cursor-pointer rounded-md px-2 py-1 text-left font-mono text-sm transition-colors',
                active ? 'bg-accent text-white' : 'hover:bg-surface-2',
              )}
            >
              {m.san}
            </button>
          );
        })}
      </li>,
    );
  }

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <ol className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Moves">
        {rows.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted">No moves yet</li>
        )}
        {rows}
      </ol>
      <div className="grid grid-cols-4 gap-1 border-t border-line p-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label="First position"
          onClick={() => setViewPly(0)}
          disabled={current === 0}
        >
          ⏮
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Previous move"
          onClick={() => setViewPly(current - 1)}
          disabled={current === 0}
        >
          ◀
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next move"
          onClick={() => setViewPly(current + 1)}
          disabled={viewPly === null}
        >
          ▶
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Latest position"
          onClick={() => setViewPly(null)}
          disabled={viewPly === null}
        >
          ⏭
        </Button>
      </div>
    </div>
  );
}
