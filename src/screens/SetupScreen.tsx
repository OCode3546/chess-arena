import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, CardTitle, Modal, Tabs, Toggle } from '@/components/ui';
import { aiPlayerName, DIFFICULTIES, DIFFICULTY_ORDER } from '@/config/difficulty';
import { CUSTOM_LIMITS, customTimeControl, TIME_CONTROLS } from '@/config/timeControls';
import { useGameStore } from '@/store/gameStore';
import { useSession } from '@/store/sessionStore';
import type { Color, Difficulty, GameSettings, TimeControl } from '@shared/types';
import { cx } from '@/utils/format';

type Mode = 'pvp' | 'pvai';
type WhiteChoice = 'a' | 'b' | 'random';
type ColorChoice = Color | 'random';

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
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [humanColor, setHumanColor] = useState<ColorChoice>('w');
  const [assists, setAssists] = useState(false);
  const assistsAllowed = DIFFICULTIES[difficulty].assistsAllowed;
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const preset = TIME_CONTROLS.find((t) => t.id === tcId);
  const timeControl: TimeControl =
    tcId === 'custom' || !preset
      ? customTimeControl(customMin, customInc)
      : { id: preset.id, initialMs: preset.initialMs, incrementMs: preset.incrementMs };

  const clean = (s: string, fallback: string) => s.trim().slice(0, 24) || fallback;

  const start = () => {
    const a = { name: clean(nameA, 'Player 1') };
    let settings: GameSettings;
    if (mode === 'pvai') {
      const human: Color = humanColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : humanColor;
      const computer = { name: aiPlayerName(difficulty) };
      settings = {
        mode: 'pvai',
        timeControl,
        players: human === 'w' ? { w: a, b: computer } : { w: computer, b: a },
        autoFlip: false,
        difficulty,
        humanColor: human,
        assists: assistsAllowed && assists,
      };
    } else {
      const b = { name: clean(nameB, 'Player 2') };
      const aIsWhite = white === 'random' ? Math.random() < 0.5 : white === 'a';
      settings = {
        mode: 'pvp',
        timeControl,
        players: aIsWhite ? { w: a, b } : { w: b, b: a },
        autoFlip,
      };
    }
    newGame(settings);
    navigate('/game');
  };

  const timeControlCard = (
    <Card className="flex flex-col gap-4">
      <CardTitle>Time control</CardTitle>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Time control">
        {[...TIME_CONTROLS, { id: 'custom', label: 'Custom', hint: 'Your choice' }].map((tc) => (
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
        ))}
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
        <p className="text-xs text-muted">
          {mode === 'pvai'
            ? `${DIFFICULTIES[difficulty].label} · you play ${humanColor === 'random' ? 'a random side' : humanColor === 'w' ? 'White' : 'Black'}`
            : 'Local games award XP once profiles arrive.'}
        </p>
        <Button
          variant="primary"
          size="lg"
          onClick={() => (savedGame ? setConfirmDiscard(true) : start())}
        >
          Start Game
        </Button>
      </div>
    </Card>
  );

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
        <div className="grid grid-cols-2 gap-4">
          <Card className="flex flex-col gap-4">
            <CardTitle>Opponent</CardTitle>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Difficulty">
              {DIFFICULTY_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={difficulty === id}
                  onClick={() => setDifficulty(id)}
                  className={cx(
                    'cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors',
                    difficulty === id
                      ? 'border-accent bg-accent/15'
                      : 'border-line bg-surface hover:bg-surface-2',
                  )}
                >
                  <div className="font-display font-bold">{DIFFICULTIES[id].label}</div>
                  <div className="text-xs text-muted">{DIFFICULTIES[id].blurb}</div>
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Your name
              <input
                className={inputClass}
                value={nameA}
                maxLength={24}
                onChange={(e) => setNameA(e.target.value)}
              />
            </label>
            <div>
              <div className="mb-2 text-xs text-muted">You play</div>
              <Tabs<ColorChoice>
                label="Your color"
                items={[
                  { id: 'w', label: 'White' },
                  { id: 'b', label: 'Black' },
                  { id: 'random', label: 'Random' },
                ]}
                value={humanColor}
                onChange={setHumanColor}
              />
            </div>
            <Toggle
              label="Hints & takebacks"
              description={
                assistsAllowed
                  ? 'Each hint or takeback costs 25% of this game’s XP.'
                  : 'Not available on Expert and Grandmaster.'
              }
              checked={assistsAllowed && assists}
              disabled={!assistsAllowed}
              onChange={setAssists}
            />
          </Card>
          {timeControlCard}
        </div>
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

          {timeControlCard}
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
