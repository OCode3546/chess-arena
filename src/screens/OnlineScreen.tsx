import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUICK_MATCH_POOLS, type Side, type TimeControl } from '@shared/protocol';
import { LevelBadge } from '@/components/Avatar';
import { inputClass } from '@/components/fields';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, CardTitle, Tabs } from '@/components/ui';
import { CUSTOM_LIMITS, customTimeControl } from '@/config/timeControls';
import { ConnectionPill } from '@/game/OnlineControls';
import { useOnline } from '@/net/onlineStore';
import { useActiveProfile } from '@/store/profileStore';
import { openReleasesPage } from '@/store/updateStore';
import { cx } from '@/utils/format';
import { useNow } from '@/utils/useNow';

/** After this long in the queue, offer to keep searching or play the computer. */
const SEARCH_PROMPT_MS = 60_000;

const tcLabel = (tc: TimeControl) => `${tc.baseMs / 60_000} + ${tc.incMs / 1000}`;
const tcKey = (tc: TimeControl) => `${tc.baseMs}+${tc.incMs}`;
const HINT: Record<string, string> = {
  '180000+2000': 'Blitz',
  '300000+3000': 'Blitz',
  '600000+0': 'Rapid',
  '900000+10000': 'Rapid',
};

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TcPicker({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: string; label: string; hint: string }[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors',
            value === o.id
              ? 'border-accent bg-accent/15'
              : 'border-line bg-surface hover:bg-surface-2',
          )}
        >
          <div className="font-display font-bold">{o.label}</div>
          <div className="text-xs text-muted">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

const POOL_OPTIONS = QUICK_MATCH_POOLS.map((tc) => ({
  id: tcKey(tc),
  label: tcLabel(tc),
  hint: HINT[tcKey(tc)] ?? '',
}));

function QuickMatchCard({ canPlay }: { canPlay: boolean }) {
  const navigate = useNavigate();
  const lobby = useOnline((s) => s.lobby);
  const findMatch = useOnline((s) => s.findMatch);
  const cancelSearch = useOnline((s) => s.cancelSearch);
  const [pool, setPool] = useState(POOL_OPTIONS[1]!.id);
  const [promptDismissedAt, setPromptDismissedAt] = useState(0);
  const searching = lobby.kind === 'queue';
  const now = useNow(searching);
  const elapsed = searching ? now - lobby.since : 0;
  const prompt =
    searching && elapsed >= SEARCH_PROMPT_MS && elapsed - promptDismissedAt >= SEARCH_PROMPT_MS;
  const pending = lobby.kind === 'pending' && lobby.action === 'queue';
  const busyElsewhere = lobby.kind !== 'idle' && !searching && !pending;

  return (
    <Card className="flex flex-col gap-4" data-quick-match>
      <div>
        <CardTitle>Quick match</CardTitle>
        <p className="mt-1 text-xs text-muted">Play the next person looking for the same clock.</p>
      </div>
      {searching ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
          <div className="thinking font-display text-lg font-bold" data-searching>
            Finding an opponent
          </div>
          <div className="text-sm text-muted tabular-nums">
            {tcLabel(lobby.tc)} · {mmss(elapsed)}
          </div>
          {prompt ? (
            <div className="flex flex-col gap-2" role="alert">
              <p className="text-sm">Nobody has turned up yet.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setPromptDismissedAt(elapsed)}>
                  Keep searching
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    cancelSearch();
                    navigate('/setup?mode=pvai');
                  }}
                >
                  Play the AI instead
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={cancelSearch}>Cancel</Button>
          )}
        </div>
      ) : (
        <>
          <TcPicker
            options={POOL_OPTIONS}
            value={pool}
            onChange={setPool}
            label="Quick match time"
          />
          <Button
            variant="primary"
            className="mt-auto"
            disabled={!canPlay || pending || busyElsewhere}
            onClick={() => {
              const tc = QUICK_MATCH_POOLS.find((t) => tcKey(t) === pool)!;
              findMatch(tc);
            }}
          >
            {pending ? 'Joining…' : 'Find opponent'}
          </Button>
        </>
      )}
    </Card>
  );
}

const PRIVATE_OPTIONS = [
  ...POOL_OPTIONS,
  { id: '1800000+0', label: '30 + 0', hint: 'Classical' },
  { id: 'custom', label: 'Custom', hint: 'Your choice' },
];

function PrivateGameCard({ canPlay }: { canPlay: boolean }) {
  const lobby = useOnline((s) => s.lobby);
  const createRoom = useOnline((s) => s.createRoom);
  const cancelRoom = useOnline((s) => s.cancelRoom);
  const [tcId, setTcId] = useState('600000+0');
  const [minutes, setMinutes] = useState(20);
  const [increment, setIncrement] = useState(5);
  const [color, setColor] = useState<Side | 'random'>('random');
  const [copied, setCopied] = useState(false);
  const room = lobby.kind === 'room' ? lobby : null;
  const now = useNow(!!room, 1000);
  const pending = lobby.kind === 'pending' && lobby.action === 'create';
  const busyElsewhere = lobby.kind !== 'idle' && !room && !pending;

  const tc = (): TimeControl => {
    if (tcId === 'custom') {
      const c = customTimeControl(minutes, increment);
      return { baseMs: c.initialMs, incMs: c.incrementMs };
    }
    const [base, inc] = tcId.split('+').map(Number);
    return { baseMs: base!, incMs: inc! };
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4" data-private-game>
      <div>
        <CardTitle>Play a friend</CardTitle>
        <p className="mt-1 text-xs text-muted">Create a game and send your friend the code.</p>
      </div>
      {room ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-2 text-center">
          <div className="text-xs font-semibold tracking-wider text-muted uppercase">
            Invite code
          </div>
          <div
            className="rounded-2xl bg-surface-2 px-5 py-3 font-mono text-4xl font-bold tracking-[0.3em] select-all"
            data-invite-code={room.code}
          >
            {room.code}
          </div>
          <Button size="sm" onClick={() => void copy(room.code)}>
            {copied ? 'Copied ✓' : 'Copy code'}
          </Button>
          <div className="thinking text-sm">Waiting for your opponent</div>
          <div className="text-xs text-muted tabular-nums">
            {tcLabel(room.tc)} · code expires in {mmss(room.expiresAt - now)}
          </div>
          <Button variant="ghost" size="sm" onClick={cancelRoom}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <TcPicker
            options={PRIVATE_OPTIONS}
            value={tcId}
            onChange={setTcId}
            label="Private game time"
          />
          {tcId === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Minutes per side
                <input
                  type="number"
                  className={inputClass}
                  value={minutes}
                  min={CUSTOM_LIMITS.minMinutes}
                  max={CUSTOM_LIMITS.maxMinutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Increment (seconds)
                <input
                  type="number"
                  className={inputClass}
                  value={increment}
                  min={0}
                  max={CUSTOM_LIMITS.maxIncrement}
                  onChange={(e) => setIncrement(Number(e.target.value))}
                />
              </label>
            </div>
          )}
          <div>
            <div className="mb-2 text-xs text-muted">You play</div>
            <Tabs<Side | 'random'>
              label="Your colour"
              items={[
                { id: 'w', label: 'White' },
                { id: 'b', label: 'Black' },
                { id: 'random', label: 'Random' },
              ]}
              value={color}
              onChange={setColor}
            />
          </div>
          <Button
            variant="primary"
            className="mt-auto"
            disabled={!canPlay || pending || busyElsewhere}
            onClick={() => createRoom(tc(), color)}
          >
            {pending ? 'Creating…' : 'Create game'}
          </Button>
        </>
      )}
    </Card>
  );
}

function JoinCard({ canPlay }: { canPlay: boolean }) {
  const lobby = useOnline((s) => s.lobby);
  const joinRoom = useOnline((s) => s.joinRoom);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = lobby.kind === 'pending' && lobby.action === 'join';
  const busy = lobby.kind !== 'idle';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(joinRoom(code));
  };

  return (
    <Card className="flex flex-col gap-4" data-join-game>
      <div>
        <CardTitle>Join with code</CardTitle>
        <p className="mt-1 text-xs text-muted">Enter the code your friend sent you.</p>
      </div>
      <form className="flex flex-1 flex-col gap-3" onSubmit={submit}>
        <input
          aria-label="Invite code"
          placeholder="K7QM2X"
          className={cx(
            inputClass,
            'h-14 text-center font-mono text-2xl tracking-[0.3em] uppercase',
          )}
          value={code}
          maxLength={12}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          className="mt-auto"
          disabled={!canPlay || busy || code.trim() === ''}
        >
          {pending ? 'Joining…' : 'Join game'}
        </Button>
      </form>
    </Card>
  );
}

export function OnlineScreen() {
  const navigate = useNavigate();
  const profile = useActiveProfile();
  const status = useOnline((s) => s.status);
  const statusDetail = useOnline((s) => s.statusDetail);
  const identity = useOnline((s) => s.identity);
  const lobbyError = useOnline((s) => s.lobbyError);
  const liveGame = useOnline((s) => (s.game && !s.game.over ? s.game.gameId : null));
  const { connect, retry, clearLobbyError, showGame } = useOnline.getState();

  useEffect(() => {
    void connect();
  }, [connect]);

  const online = status === 'online';
  const canPlay = online && !liveGame;
  const name = identity?.displayName || profile?.name || 'Player';

  return (
    <ScreenShell
      id="online"
      title="Play Online"
      subtitle="Play people anywhere — no account needed"
      actions={<ConnectionPill />}
    >
      {status === 'upgrade' ? (
        <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-sm" role="alert">
          <span className="flex-1">Please update Chess Arena to play online.</span>
          <Button size="sm" variant="primary" onClick={openReleasesPage}>
            Download update
          </Button>
        </div>
      ) : status === 'offline' ? (
        <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-sm" role="alert">
          <span className="flex-1">
            Can’t reach the game server. Check your internet connection — we keep trying.
          </span>
          <Button size="sm" onClick={retry}>
            Retry now
          </Button>
        </div>
      ) : (
        (status === 'busy' || status === 'replaced') && (
          <div className="glass rounded-2xl px-4 py-3 text-sm" role="alert">
            {statusDetail}
          </div>
        )
      )}

      {liveGame && (
        <div className="glass flex items-center gap-3 rounded-2xl px-4 py-3 text-sm" role="status">
          <span className="flex-1">You have an online game in progress.</span>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (showGame()) navigate('/game');
            }}
          >
            Back to game
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 text-sm" data-online-name>
        <span className="text-muted">Opponents see you as</span>
        <b className="truncate">{name}</b>
        {profile && <LevelBadge level={profile.level} className="h-5 px-2 text-[11px]" />}
        <Button size="sm" variant="ghost" onClick={() => navigate('/settings')}>
          Change name
        </Button>
      </div>

      {lobbyError && (
        <div
          className="flex items-center gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm"
          role="alert"
          data-lobby-error
        >
          <span className="flex-1">{lobbyError}</span>
          <Button size="sm" variant="ghost" onClick={clearLobbyError}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <QuickMatchCard canPlay={canPlay} />
        <PrivateGameCard canPlay={canPlay} />
        <JoinCard canPlay={canPlay} />
      </div>
      <p className="text-xs text-muted">
        Online games are timed and decided by the server. If your connection drops you have 60
        seconds to come back before the game is lost.
      </p>
    </ScreenShell>
  );
}
