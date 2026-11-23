import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Color, GameRecord } from '@shared/types';
import { moveSound } from '@/audio/cues';
import { playSound } from '@/audio/sfx';
import { Button } from '@/components/ui';
import { Board } from '@/game/Board';
import { MoveListView } from '@/game/MoveList';
import { clampPly, modeLabel, movesFromPgn, reasonLabel, sideOf } from '@/game/review';
import { other } from '@/game/rules';
import { exportGamePgn } from '@/store/dataActions';
import { useProfiles } from '@/store/profileStore';
import { formatDateTime } from '@/utils/format';
import { SideDot } from './HistoryScreen';

const SCORE: Record<GameRecord['result'], Record<Color, string>> = {
  '1-0': { w: '1', b: '0' },
  '0-1': { w: '0', b: '1' },
  '1/2-1/2': { w: '½', b: '½' },
};

function Message({ title, children }: { title: string; children?: string }) {
  const navigate = useNavigate();
  return (
    <section
      data-screen="review"
      className="flex h-full flex-col items-center justify-center gap-3 text-center"
    >
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      <Button onClick={() => navigate('/history')}>← Back to history</Button>
    </section>
  );
}

/** Step through a finished game from the history. */
export function ReviewScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const activeId = useProfiles((s) => s.activeId);
  const [record, setRecord] = useState<GameRecord | null | undefined>(undefined);
  const [ply, setPly] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<Color>('w');

  useEffect(() => {
    let live = true;
    window.chessArena.storage
      .getHistory()
      .then((list) => {
        if (!live) return;
        const found = list.find((g) => g.id === id) ?? null;
        setRecord(found);
        setPly(null);
        // The active profile sees the game from its own side.
        if (found) setOrientation(sideOf(found, useProfiles.getState().activeId) ?? 'w');
      })
      .catch((err) => {
        console.error(err);
        if (live) setRecord(null);
      });
    return () => {
      live = false;
    };
  }, [id]);

  const moves = useMemo(() => (record ? movesFromPgn(record.pgn) : null), [record]);

  const go = useCallback(
    (next: number | null) => {
      if (!moves) return;
      const target = clampPly(next, moves.length);
      const from = ply ?? moves.length;
      const to = target ?? moves.length;
      if (to === from + 1) playSound(moveSound(moves[to - 1]!));
      setPly(target);
    },
    [moves, ply],
  );

  // ←/→ step, Home/End jump, F flips.
  useEffect(() => {
    if (!moves) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const current = ply ?? moves.length;
      const actions: Record<string, () => void> = {
        ArrowLeft: () => go(current - 1),
        ArrowRight: () => go(current + 1),
        Home: () => go(0),
        End: () => go(null),
        f: () => setOrientation(other),
        F: () => setOrientation(other),
      };
      const action = actions[e.key];
      if (action) {
        e.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moves, ply, go]);

  if (record === undefined) return <section data-screen="review" className="h-full" />;
  if (record === null) {
    return <Message title="Game not found">It may have been removed from your history.</Message>;
  }
  if (!moves) {
    return <Message title="This game cannot be shown">Its moves could not be read.</Message>;
  }

  const xp = activeId ? record.xpAwarded[activeId] : undefined;
  const player = (color: Color) => (
    <div className="flex items-center gap-2.5">
      <SideDot color={color} />
      <span className="min-w-0 flex-1 truncate font-semibold">
        {color === 'w' ? record.whiteName : record.blackName}
      </span>
      <span className="font-display text-lg font-bold tabular-nums">
        {SCORE[record.result][color]}
      </span>
    </div>
  );

  return (
    <section data-screen="review" className="h-full">
      <div className="grid h-full grid-cols-[minmax(0,1fr)_320px] gap-5 p-5">
        <div className="min-h-0 min-w-0">
          <Board review={{ history: moves, ply, orientation }} />
        </div>
        <aside className="flex min-h-0 flex-col gap-3">
          <div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/history')}>
              ← History
            </Button>
          </div>
          <div className="glass flex flex-col gap-2 rounded-2xl p-4">
            {player(other(orientation))}
            {player(orientation)}
            <div className="border-t border-line pt-2 text-xs text-muted" data-review-summary>
              {record.result} {reasonLabel(record.reason)} · {record.moves} moves
              <br />
              {modeLabel(record.mode)} · {formatDateTime(record.date)}
              {xp !== undefined && (
                <span className="font-semibold text-accent-text"> · +{xp} XP</span>
              )}
            </div>
          </div>
          <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
              <span className="font-display text-sm font-bold">Moves</span>
              <span className="text-xs text-muted">← → to step</span>
            </div>
            <MoveListView className="flex-1" history={moves} viewPly={ply} onSelect={go} />
          </div>
          <div className="glass grid grid-cols-2 gap-2 rounded-2xl p-3">
            <Button onClick={() => setOrientation(other)} title="Flip board (F)">
              ⇅ Flip
            </Button>
            <Button onClick={() => void exportGamePgn(record.id)}>Export PGN</Button>
          </div>
        </aside>
      </div>
    </section>
  );
}
