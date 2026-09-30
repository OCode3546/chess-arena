import { Button, Modal } from '@/components/ui';
import { useGameStore } from '@/store/gameStore';
import { useProfiles } from '@/store/profileStore';
import { REASON_LABEL } from './rules';
import { XpSummary } from './XpSummary';

interface GameOverModalProps {
  open: boolean;
  onReview: () => void;
  onRematch: () => void;
  onNewGame: () => void;
  onHome: () => void;
}

export function GameOverModal({
  open,
  onReview,
  onRematch,
  onNewGame,
  onHome,
}: GameOverModalProps) {
  const result = useGameStore((s) => s.result);
  const players = useGameStore((s) => s.settings?.players);
  const moves = useGameStore((s) => s.history.length);
  const human = useGameStore((s) => (s.settings?.mode === 'pvai' ? s.settings.humanColor : null));
  const startedAt = useGameStore((s) => s.startedAt);
  const awards = useProfiles((s) =>
    s.lastMatch?.gameId === startedAt ? s.lastMatch.awards : null,
  );
  if (!result || !players) return null;

  const winnerName = result.winner ? players[result.winner].name : null;
  const headline = !result.winner
    ? 'Draw'
    : human && result.winner !== human
      ? 'Defeat'
      : 'Victory';
  const detail = result.winner
    ? `${winnerName} (${result.winner === 'w' ? 'White' : 'Black'}) wins ${REASON_LABEL[result.reason]}.`
    : `The game is drawn ${REASON_LABEL[result.reason]}.`;

  return (
    <Modal open={open} onClose={onReview} className="max-w-lg">
      <div className="flex flex-col items-center text-center">
        <div className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">
          Game over · {result.result}
        </div>
        <h2 className="mt-2 bg-gradient-to-r from-accent-soft to-accent bg-clip-text font-display text-5xl font-bold text-transparent">
          {headline}
        </h2>
        <p className="mt-3 text-base text-fg">{detail}</p>
        <p className="mt-1 text-sm text-muted">{Math.ceil(moves / 2)} moves played</p>
      </div>
      {awards && <XpSummary awards={awards} />}
      <div className="mt-7 grid grid-cols-2 gap-2">
        <Button variant="primary" onClick={onRematch} data-autofocus>
          Rematch
        </Button>
        <Button onClick={onNewGame}>New Game</Button>
        <Button variant="ghost" onClick={onReview}>
          Review Game
        </Button>
        <Button variant="ghost" onClick={onHome}>
          Home
        </Button>
      </div>
    </Modal>
  );
}
