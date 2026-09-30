import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Color, GameRecord } from '@shared/types';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Tabs } from '@/components/ui';
import type { Outcome } from '@/config/progression';
import { outcomeOf, reasonLabel, sideOf } from '@/game/review';
import { exportGamePgn } from '@/store/dataActions';
import { useActiveProfile } from '@/store/profileStore';
import { cx, formatDateTime } from '@/utils/format';

type Filter = 'all' | 'mine' | 'pvai' | 'pvp';

const OUTCOME: Record<Outcome, { label: string; className: string }> = {
  win: { label: 'Win', className: 'bg-success/15 text-success' },
  loss: { label: 'Loss', className: 'bg-danger/15 text-danger' },
  draw: { label: 'Draw', className: 'bg-surface-2 text-muted' },
};

export function SideDot({ color }: { color: Color }) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-line',
        color === 'w' ? 'bg-[#f3f4f8]' : 'bg-[#1d2030]',
      )}
    />
  );
}

function HistoryRow({ game, profileId }: { game: GameRecord; profileId: string | null }) {
  const navigate = useNavigate();
  const side = sideOf(game, profileId);
  const outcome = side ? OUTCOME[outcomeOf(game, side)] : null;
  const xp = profileId ? game.xpAwarded[profileId] : undefined;
  return (
    <li data-game={game.id} className="glass flex items-center gap-4 rounded-2xl px-4 py-3">
      <span
        className={cx(
          'w-14 shrink-0 rounded-lg py-1 text-center text-xs font-bold',
          outcome?.className ?? 'bg-surface-2 text-fg',
        )}
      >
        {outcome?.label ?? game.result}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SideDot color="w" />
          <span className="truncate">{game.whiteName}</span>
          <span className="text-xs font-normal text-muted">vs</span>
          <SideDot color="b" />
          <span className="truncate">{game.blackName}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {game.result} {reasonLabel(game.reason)} · {game.moves} moves ·{' '}
          {game.mode === 'pvai' ? 'vs computer' : 'local'} · {formatDateTime(game.date)}
        </div>
      </div>
      {xp !== undefined && (
        <span className="shrink-0 text-sm font-semibold text-accent-text tabular-nums">
          +{xp} XP
        </span>
      )}
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" onClick={() => navigate(`/history/${game.id}`)}>
          Review
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void exportGamePgn(game.id)}
          aria-label={`Export ${game.whiteName} vs ${game.blackName} as PGN`}
          title="Export as PGN"
        >
          PGN ↓
        </Button>
      </div>
    </li>
  );
}

export function HistoryScreen() {
  const navigate = useNavigate();
  const profile = useActiveProfile();
  const profileId = profile?.id ?? null;
  const [games, setGames] = useState<GameRecord[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let live = true;
    window.chessArena.storage
      .getHistory()
      .then((list) => live && setGames(list))
      .catch((err) => {
        console.error(err);
        if (live) setGames([]);
      });
    return () => {
      live = false;
    };
  }, []);

  const shown = useMemo(
    () =>
      (games ?? []).filter((g) =>
        filter === 'all'
          ? true
          : filter === 'mine'
            ? sideOf(g, profileId) !== null
            : g.mode === filter,
      ),
    [games, filter, profileId],
  );

  const tally = useMemo(() => {
    const t = { win: 0, draw: 0, loss: 0 };
    for (const g of shown) {
      const side = sideOf(g, profileId);
      if (side) t[outcomeOf(g, side)]++;
    }
    return t;
  }, [shown, profileId]);

  return (
    <ScreenShell
      id="history"
      title="History"
      subtitle={
        games
          ? `${games.length} finished game${games.length === 1 ? '' : 's'} · review any game or export it as PGN`
          : undefined
      }
    >
      {games === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : games.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
          <div className="font-display text-lg font-bold">No finished games yet</div>
          <p className="max-w-md text-sm text-muted">
            Every game you finish is kept here, ready to review move by move.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" onClick={() => navigate('/setup?mode=pvai')}>
              Play vs AI
            </Button>
            <Button onClick={() => navigate('/setup?mode=pvp')}>Play vs Player</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs<Filter>
              label="Filter games"
              className="w-full max-w-md"
              items={[
                { id: 'all', label: 'All' },
                { id: 'mine', label: profile ? profile.name : 'Mine', disabled: !profile },
                { id: 'pvai', label: 'vs AI' },
                { id: 'pvp', label: 'Local' },
              ]}
              value={filter}
              onChange={setFilter}
            />
            {profile && tally.win + tally.draw + tally.loss > 0 && (
              <div className="text-sm text-muted" data-tally>
                {profile.name}: <b className="text-success">{tally.win}W</b> ·{' '}
                <b className="text-fg">{tally.draw}D</b> ·{' '}
                <b className="text-danger">{tally.loss}L</b>
              </div>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No games match this filter.</p>
          ) : (
            <ol className="flex flex-col gap-2" aria-label="Finished games">
              {shown.map((g) => (
                <HistoryRow key={g.id} game={g} profileId={profileId} />
              ))}
            </ol>
          )}
        </>
      )}
    </ScreenShell>
  );
}
