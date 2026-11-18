import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAiOpponent } from '@/ai/useAiOpponent';
import { Button, Modal, Tabs } from '@/components/ui';
import { Board } from '@/game/Board';
import { GameOverModal } from '@/game/GameOverModal';
import { MoveList } from '@/game/MoveList';
import { PlayerStrip } from '@/game/PlayerStrip';
import { other, REASON_LABEL, type GameResult } from '@/game/rules';
import { aiColorOf, undoablePlies, useGameStore } from '@/store/gameStore';
import { MOD_KEY } from '@/utils/platform';
import { useMediaQuery } from '@/utils/useMediaQuery';

type Dialog = null | 'resign' | 'draw';

const AUTOSAVE_MS = 10_000;

export function GameScreen() {
  const navigate = useNavigate();
  const status = useGameStore((s) => s.status);
  const settings = useGameStore((s) => s.settings);
  const orientation = useGameStore((s) => s.orientation);
  const paused = useGameStore((s) => s.paused);
  const result = useGameStore((s) => s.result);
  const turn = useGameStore((s) => s.fen.split(' ')[1] as 'w' | 'b');
  const viewPly = useGameStore((s) => s.viewPly);
  const canUndo = useGameStore(
    (s) => !!s.settings?.assists && s.status === 'playing' && !s.paused && undoablePlies(s) > 0,
  );
  const game = useGameStore.getState;
  const ai = useAiOpponent();

  const [dialog, setDialog] = useState<Dialog>(null);
  /** The result whose modal the player closed (to review the game). */
  const [dismissedResult, setDismissedResult] = useState<GameResult | null>(null);
  const [tab, setTab] = useState<'game' | 'moves'>('game');
  const wide = useMediaQuery('(min-width: 1180px)');
  const playing = status === 'playing';
  const showGameOver = status === 'over' && result !== null && result !== dismissedResult;
  // Paused games (including restored timed games) always show the pause menu.
  const pauseOpen = playing && paused;

  // Clock loop + periodic auto-save of the clocks.
  useEffect(() => {
    if (status !== 'playing') return;
    const tick = window.setInterval(() => game().tick(), 100);
    const save = window.setInterval(() => {
      const s = game();
      if (s.clockStarted && !s.paused) s.persist(Date.now());
    }, AUTOSAVE_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(save);
    };
  }, [status, game]);

  const openPause = () => {
    setDialog(null);
    game().setPaused(true);
  };
  const resume = () => game().setPaused(false);

  // Shortcuts: F flip, Ctrl+Z takeback, Esc pause menu (open modals handle their own Esc).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (!dialog && canUndo) game().undo();
      } else if (e.key === 'f' || e.key === 'F') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) game().flip();
      } else if (e.key === 'Escape') {
        if (!dialog && game().status === 'playing' && !game().pendingPromotion) openPause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const saveAndExit = () => {
    const s = game();
    if (s.status === 'playing') {
      if (!s.paused) s.setPaused(true);
      else s.persist();
    }
    setDialog(null);
    navigate('/');
  };

  const rematch = () => {
    if (!settings) return;
    setDialog(null);
    game().newGame({
      ...settings,
      players: { w: settings.players.b, b: settings.players.w },
      ...(settings.humanColor && { humanColor: other(settings.humanColor) }),
    });
  };

  if (status === 'idle' || !settings) {
    return (
      <section
        data-screen="game"
        className="flex h-full flex-col items-center justify-center gap-4"
      >
        <h1 className="font-display text-2xl font-bold">No game in progress</h1>
        <p className="text-sm text-muted">Start a new game from the setup screen.</p>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/')}>Home</Button>
          <Button variant="primary" onClick={() => navigate('/setup?mode=pvp')}>
            New game
          </Button>
        </div>
      </section>
    );
  }

  const top = other(orientation);
  const bottom = orientation;
  const vsAi = aiColorOf(settings) !== null;
  // vs AI the human always resigns for themselves; locally the side to move does.
  const resigner = vsAi && settings.humanColor ? settings.humanColor : turn;
  const moverName = settings.players[turn].name;

  const controls = (
    <div className="glass flex flex-col gap-2 rounded-2xl p-3">
      {playing ? (
        <>
          {vsAi && settings.assists && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => game().undo()}
                disabled={!canUndo}
                title={`Take back your last move (${MOD_KEY}+Z) · costs XP`}
              >
                ↶ Undo
              </Button>
              <Button
                onClick={() => void ai.requestHint()}
                disabled={!ai.humanTurn || ai.hintPending || viewPly !== null}
                title="Show the best move · costs XP"
              >
                {ai.hintPending ? 'Thinking…' : '💡 Hint'}
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => (vsAi ? void ai.offerDraw() : setDialog('draw'))}
              disabled={viewPly !== null || (vsAi && !ai.canOfferDraw)}
              title={vsAi ? 'The computer accepts if the position is level' : undefined}
            >
              {ai.drawPending ? 'Considering…' : '½ Offer draw'}
            </Button>
            <Button variant="danger" onClick={() => setDialog('resign')}>
              ⚑ Resign
            </Button>
            <Button onClick={() => game().flip()} title="Flip board (F)">
              ⇅ Flip
            </Button>
            <Button onClick={openPause} title="Pause (Esc)">
              ❚❚ Pause
            </Button>
          </div>
          <Button variant="ghost" block onClick={saveAndExit}>
            Save &amp; Exit
          </Button>
        </>
      ) : (
        <>
          {result && (
            <div className="px-1 pb-1 text-sm">
              <span className="font-semibold">{result.result}</span>{' '}
              <span className="text-muted">
                {result.winner ? `${settings.players[result.winner].name} won` : 'Draw'}{' '}
                {REASON_LABEL[result.reason]}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" onClick={rematch}>
              Rematch
            </Button>
            <Button onClick={() => setDismissedResult(null)}>Result</Button>
            <Button onClick={() => game().flip()}>⇅ Flip</Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              Home
            </Button>
          </div>
        </>
      )}
    </div>
  );

  let layout: ReactNode;
  if (wide) {
    layout = (
      <div className="grid h-full grid-cols-[260px_minmax(0,1fr)_300px] gap-5 p-5">
        <aside className="flex min-h-0 flex-col justify-between gap-4">
          <PlayerStrip color={top} compact />
          <PlayerStrip color={bottom} compact />
        </aside>
        <div className="min-h-0 min-w-0">
          <Board />
        </div>
        <aside className="flex min-h-0 flex-col gap-4">
          <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
            <div className="border-b border-line px-4 py-3 font-display text-sm font-bold">
              Moves
            </div>
            <MoveList className="flex-1" />
          </div>
          {controls}
        </aside>
      </div>
    );
  } else {
    layout = (
      <div className="grid h-full grid-cols-[minmax(0,1fr)_320px] gap-4 p-4">
        <div className="min-h-0 min-w-0">
          <Board />
        </div>
        <aside className="flex min-h-0 flex-col gap-3">
          <Tabs
            label="Game panels"
            items={[
              { id: 'game', label: 'Game' },
              { id: 'moves', label: 'Moves' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'game' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <PlayerStrip color={top} />
              <PlayerStrip color={bottom} />
              {controls}
            </div>
          ) : (
            <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
              <MoveList className="flex-1" />
            </div>
          )}
        </aside>
      </div>
    );
  }

  return (
    <section data-screen="game" className="relative h-full">
      {layout}

      <Modal
        open={pauseOpen}
        title="Paused"
        onClose={resume}
        actions={
          <>
            <Button variant="ghost" onClick={saveAndExit}>
              Save &amp; Exit
            </Button>
            <Button variant="primary" onClick={resume} data-autofocus>
              Resume
            </Button>
          </>
        }
      >
        The clocks are stopped. Press <b>Esc</b> or <b>Resume</b> to continue.
      </Modal>

      <Modal
        open={playing && dialog === 'resign'}
        title="Resign?"
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDialog(null);
                game().resign(resigner);
              }}
            >
              Resign as {resigner === 'w' ? 'White' : 'Black'}
            </Button>
          </>
        }
      >
        {settings.players[resigner].name} ({resigner === 'w' ? 'White' : 'Black'}) will resign and{' '}
        {settings.players[other(resigner)].name} wins the game.
      </Modal>

      <Modal
        open={playing && dialog === 'draw'}
        title="Draw offer"
        onClose={() => setDialog(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)} data-autofocus>
              Decline
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setDialog(null);
                game().agreeDraw();
              }}
            >
              Accept draw
            </Button>
          </>
        }
      >
        {moverName} offers a draw. <b>{settings.players[other(turn)].name}</b>, do you accept?
      </Modal>

      <GameOverModal
        open={showGameOver}
        onReview={() => setDismissedResult(result)}
        onRematch={rematch}
        onNewGame={() => navigate(`/setup?mode=${settings.mode}`)}
        onHome={() => navigate('/')}
      />
    </section>
  );
}
