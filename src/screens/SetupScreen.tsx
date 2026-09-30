import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, CardTitle, Modal, Tabs, Toggle } from '@/components/ui';
import { CUSTOM_LIMITS, customTimeControl, TIME_CONTROLS } from '@/config/timeControls';
import { useGameStore } from '@/store/gameStore';
import { useSession } from '@/store/sessionStore';
import type { GameSettings, TimeControl } from '@shared/types';
import { cx } from '@/utils/format';

type Mode = 'pvp' | 'pvai';
type WhiteChoice = 'a' | 'b' | 'random';

const inputClass =
  'h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-accent-soft';

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <input
        type="number"
        className={inputClass}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function SetupScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const profileName = useSession((s) => s.profile.name);
  const savedGame = useSession((s) => s.savedGame);
  const newGame = useGameStore((s) => s.newGame);

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'pvai' ? 'pvai' : 'pvp');
  const [nameA, setNameA] = useState(profileName);
  const [nameB, setNameB] = useState('Guest');
  const [white, setWhite] = useState<WhiteChoice>('a');
  const [tcId, setTcId] = useState('10+0');
  const [customMin, setCustomMin] = useState(20);
  const [customInc, setCustomInc] = useState(5);
  const [autoFlip, setAutoFlip] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const preset = TIME_CONTROLS.find((t) => t.id === tcId);
  const timeControl: TimeControl =
    tcId === 'custom' || !preset
      ? customTimeControl(customMin, customInc)
      : { id: preset.id, initialMs: preset.initialMs, incrementMs: preset.incrementMs };

  const clean = (s: string, fallback: string) => s.trim().slice(0, 24) || fallback;

  const start = () => {
    const a = { name: clean(nameA, 'Player 1') };
    const b = { name: clean(nameB, 'Player 2') };
    const aIsWhite = white === 'random' ? Math.random() < 0.5 : white === 'a';
    const settings: GameSettings = {
      mode: 'pvp',
      timeControl,
      players: aIsWhite ? { w: a, b } : { w: b, b: a },
      autoFlip,
    };
    newGame(settings);
    navigate('/game');
  };

  return (
    <ScreenShell id="setup" title="New Game" subtitle="Choose opponents and a time control">
      <Tabs<Mode>
        className="max-w-sm"
        label="Game mode"
        items={[
          { id: 'pvai', label: 'vs AI' },
          { id: 'pvp', label: 'vs Player' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {mode === 'pvai' ? (
        <Card className="flex flex-col items-center gap-2 py-12 text-center">
          <CardTitle>The computer opponent is on its way</CardTitle>
          <p className="max-w-md text-sm text-muted">
            Six difficulty levels from Beginner to Grandmaster arrive in the next update. Meanwhile,
            play a friend on this PC.
          </p>
          <Button className="mt-3" onClick={() => setMode('pvp')}>
            Set up a local game
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <Card className="flex flex-col gap-4">
            <CardTitle>Players</CardTitle>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Player 1
              <input
                className={inputClass}
                value={nameA}
                maxLength={24}
                onChange={(e) => setNameA(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Player 2
              <input
                className={inputClass}
                value={nameB}
                maxLength={24}
                onChange={(e) => setNameB(e.target.value)}
              />
            </label>
            <div>
              <div className="mb-2 text-xs text-muted">Who plays White?</div>
              <Tabs<WhiteChoice>
                label="Who plays White"
                items={[
                  { id: 'a', label: clean(nameA, 'Player 1') },
                  { id: 'b', label: clean(nameB, 'Player 2') },
                  { id: 'random', label: 'Random' },
                ]}
                value={white}
                onChange={setWhite}
              />
            </div>
            <Toggle
              label="Auto-flip board"
              description="Turn the board to face the player to move"
              checked={autoFlip}
              onChange={setAutoFlip}
            />
          </Card>

          <Card className="flex flex-col gap-4">
            <CardTitle>Time control</CardTitle>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Time control">
              {[...TIME_CONTROLS, { id: 'custom', label: 'Custom', hint: 'Your choice' }].map(
                (tc) => (
                  <button
                    key={tc.id}
                    type="button"
                    role="radio"
                    aria-checked={tcId === tc.id}
                    onClick={() => setTcId(tc.id)}
                    className={cx(
                      'cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors',
                      tcId === tc.id
                        ? 'border-accent bg-accent/15'
                        : 'border-line bg-surface hover:bg-surface-2',
                    )}
                  >
                    <div className="font-display font-bold">{tc.label}</div>
                    <div className="text-xs text-muted">{tc.hint}</div>
                  </button>
                ),
              )}
            </div>
            {tcId === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Minutes per side"
                  value={customMin}
                  min={CUSTOM_LIMITS.minMinutes}
                  max={CUSTOM_LIMITS.maxMinutes}
                  onChange={setCustomMin}
                />
                <NumberField
                  label="Increment (seconds)"
                  value={customInc}
                  min={0}
                  max={CUSTOM_LIMITS.maxIncrement}
                  onChange={setCustomInc}
                />
              </div>
            )}
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-4">
              <p className="text-xs text-muted">Local games award XP once profiles arrive.</p>
              <Button
                variant="primary"
                size="lg"
                onClick={() => (savedGame ? setConfirmDiscard(true) : start())}
              >
                Start Game
              </Button>
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={confirmDiscard}
        title="Replace saved game?"
        onClose={() => setConfirmDiscard(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDiscard(false)} data-autofocus>
              Cancel
            </Button>
            <Button variant="primary" onClick={start}>
              Start new game
            </Button>
          </>
        }
      >
        You have an unfinished game. Starting a new one will replace it.
      </Modal>
    </ScreenShell>
  );
}
