import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal } from '@/components/ui';
import type { ConnStatus } from '@/net/connection';
import { useOnline, type RematchState } from '@/net/onlineStore';
import { useGameStore } from '@/store/gameStore';
import { cx } from '@/utils/format';
import { REASON_LABEL } from './rules';

const PILL: Record<ConnStatus, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  idle: { label: 'Not connected', tone: 'bad' },
  connecting: { label: 'Connecting…', tone: 'warn' },
  online: { label: 'Connected', tone: 'ok' },
  reconnecting: { label: 'Reconnecting…', tone: 'warn' },
  offline: { label: 'Offline — retrying', tone: 'bad' },
  upgrade: { label: 'Update required', tone: 'bad' },
  busy: { label: 'Server busy', tone: 'warn' },
  replaced: { label: 'Playing in another window', tone: 'bad' },
};

/** Green / amber / red dot with the connection state. */
export function ConnectionPill({ className }: { className?: string }) {
  const status = useOnline((s) => s.status);
  const { label, tone } = PILL[status];
  return (
    <span
      role="status"
      data-connection={status}
      className={cx(
        'inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold',
        className,
      )}
    >
      <span
        aria-hidden
        className={cx(
          'h-2 w-2 rounded-full',
          tone === 'ok' && 'bg-success',
          tone === 'warn' && 'animate-pulse bg-warning',
          tone === 'bad' && 'bg-danger',
        )}
      />
      {label}
    </span>
  );
}

/** Rematch for online games: an offer the opponent accepts or declines. */
export function OnlineRematchButton({ autoFocus }: { autoFocus?: boolean }) {
  const state = useOnline((s) => s.game?.rematch ?? 'unavailable');
  const rematch = useOnline((s) => s.rematch);
  const decline = useOnline((s) => s.declineRematch);
  if (state === 'received') {
    return (
      <div className="col-span-2 grid grid-cols-2 gap-2" data-rematch="received">
        <Button variant="primary" onClick={rematch} data-autofocus={autoFocus || undefined}>
          Accept rematch
        </Button>
        <Button onClick={decline}>Decline</Button>
      </div>
    );
  }
  const label: Record<Exclude<RematchState, 'received'>, string> = {
    none: 'Rematch',
    sent: 'Rematch offered…',
    declined: 'Rematch declined',
    unavailable: 'Rematch unavailable',
  };
  return (
    <Button
      variant="primary"
      onClick={rematch}
      disabled={state !== 'none'}
      data-rematch={state}
      data-autofocus={autoFocus || undefined}
    >
      {label[state]}
    </Button>
  );
}

/** Side-panel controls of an online game (no undo, hint or pause). */
export function OnlineControls({ onShowResult }: { onShowResult: () => void }) {
  const navigate = useNavigate();
  const status = useGameStore((s) => s.status);
  const result = useGameStore((s) => s.result);
  const viewPly = useGameStore((s) => s.viewPly);
  const players = useGameStore((s) => s.settings?.players);
  const color = useOnline((s) => s.game?.color);
  const plies = useOnline((s) => s.game?.state?.seq ?? 0);
  const offerFrom = useOnline((s) => s.game?.state?.drawOfferFrom ?? null);
  const act = useOnline((s) => s.act);
  const [confirmResign, setConfirmResign] = useState(false);
  const playing = status === 'playing';
  const canAbort = playing && plies < 2;
  const theirOffer = !!color && offerFrom !== null && offerFrom !== color;
  const myOffer = !!color && offerFrom === color;

  return (
    <div className="glass flex flex-col gap-2 rounded-2xl p-3" data-online-controls>
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-xs font-semibold tracking-wider text-muted uppercase">Online</span>
        <ConnectionPill />
      </div>
      {playing ? (
        <>
          {theirOffer && (
            <div
              className="flex flex-col gap-2 rounded-xl bg-accent/15 p-3 text-sm"
              role="alert"
              data-draw-offer
            >
              <span>
                <b>{players?.[offerFrom!].name}</b> offers a draw.
              </span>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="primary" onClick={() => act('game.drawAccept')}>
                  Accept
                </Button>
                <Button size="sm" onClick={() => act('game.drawDecline')}>
                  Decline
                </Button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => act('game.drawOffer')}
              disabled={myOffer || theirOffer || viewPly !== null}
              title="Your opponent can accept or decline"
            >
              {myOffer ? 'Draw offered…' : '½ Offer draw'}
            </Button>
            <Button variant="danger" onClick={() => setConfirmResign(true)}>
              ⚑ Resign
            </Button>
            <Button onClick={() => useGameStore.getState().flip()} title="Flip board (F)">
              ⇅ Flip
            </Button>
            {canAbort && (
              <Button
                onClick={() => act('game.abort')}
                title="End the game without a result (only before both players have moved)"
              >
                ✕ Abort
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          {result && (
            <div className="px-1 pb-1 text-sm">
              {result.result !== '*' && <span className="font-semibold">{result.result} </span>}
              <span className="text-muted">
                {result.result === '*'
                  ? `No result ${REASON_LABEL[result.reason]}`
                  : `${result.winner ? `${players?.[result.winner].name} won` : 'Draw'} ${REASON_LABEL[result.reason]}`}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <OnlineRematchButton />
            <Button onClick={onShowResult}>Result</Button>
            <Button onClick={() => navigate('/online')}>New game</Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              Home
            </Button>
          </div>
        </>
      )}

      <Modal
        open={playing && confirmResign}
        title="Resign?"
        onClose={() => setConfirmResign(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmResign(false)} data-autofocus>
              Keep playing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmResign(false);
                act('game.resign');
              }}
            >
              Resign
            </Button>
          </>
        }
      >
        Your opponent wins the game.
      </Modal>
    </div>
  );
}
