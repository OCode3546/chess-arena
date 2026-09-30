import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LevelBadge, ProfileAvatar } from '@/components/Avatar';
import { cleanName, inputClass, NAME_MAX } from '@/components/fields';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, CardTitle, Modal, Tabs, Toggle } from '@/components/ui';
import { aiPlayerName, DIFFICULTIES, DIFFICULTY_ORDER } from '@/config/difficulty';
import { AI_XP, PVP_RULES } from '@/config/progression';
import { CUSTOM_LIMITS, customTimeControl, TIME_CONTROLS } from '@/config/timeControls';
import { pvpAward } from '@/progression/awards';
import { GUEST, localDay } from '@/progression/match';
import { useGameStore } from '@/store/gameStore';
import { useActiveProfile, useProfiles } from '@/store/profileStore';
import { useSession } from '@/store/sessionStore';
import type {
  Color,
  Difficulty,
  GameSettings,
  PlayerInfo,
  Profile,
  TimeControl,
} from '@shared/types';
import { cx } from '@/utils/format';

type Mode = 'pvp' | 'pvai';
type WhiteChoice = 'a' | 'b' | 'random';
type ColorChoice = Color | 'random';

/** Profile picker for one side; `allowGuest` adds a Guest entry with a free name. */
function PlayerPicker({
  label,
  profiles,
  value,
  onChange,
  allowGuest,
  guestName,
  onGuestName,
}: {
  label: string;
  profiles: Profile[];
  value: string;
  onChange: (id: string) => void;
  allowGuest?: boolean;
  guestName?: string;
  onGuestName?: (name: string) => void;
}) {
  const selected = profiles.find((p) => p.id === value);
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-muted">
        {label}
        <div className="flex items-center gap-3">
          {selected ? (
            <ProfileAvatar profile={selected} size={40} className="rounded-xl" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-sm font-bold text-muted">
              ?
            </div>
          )}
          <select
            className={cx(inputClass, 'cursor-pointer')}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · Lv {p.level}
              </option>
            ))}
            {allowGuest && <option value={GUEST}>Guest (no XP)</option>}
          </select>
          {selected && <LevelBadge level={selected.level} />}
        </div>
      </label>
      {!selected && onGuestName && (
        <input
          className={inputClass}
          value={guestName}
          maxLength={NAME_MAX}
          aria-label={`${label} guest name`}
          placeholder="Guest name"
          onChange={(e) => onGuestName(e.target.value)}
        />
      )}
    </div>
  );
}

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
  const profiles = useProfiles((s) => s.profiles);
  const setActive = useProfiles((s) => s.setActive);
  const active = useActiveProfile();
  const savedGame = useSession((s) => s.savedGame);
  const newGame = useGameStore((s) => s.newGame);

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'pvai' ? 'pvai' : 'pvp');
  const [slotA, setSlotA] = useState(active?.id ?? GUEST);
  const [slotB, setSlotB] = useState(GUEST);
  const [nameA, setNameA] = useState('Player 1');
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

  const clean = (s: string, fallback: string) => cleanName(s) || fallback;
  const profileById = (id: string) => profiles.find((p) => p.id === id);
  const player = (slot: string, guestName: string, fallback: string): PlayerInfo => {
    const p = profileById(slot);
    return p ? { name: p.name, profileId: p.id } : { name: clean(guestName, fallback) };
  };
  const labelOf = (slot: string, guestName: string, fallback: string) =>
    player(slot, guestName, fallback).name;

  const start = () => {
    let settings: GameSettings;
    if (mode === 'pvai') {
      const a: PlayerInfo = active
        ? { name: active.name, profileId: active.id }
        : { name: 'Player' };
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
      const a = player(slotA, nameA, 'Player 1');
      const b = player(slotB, nameB, 'Player 2');
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

  const xpPreview = (() => {
    if (mode === 'pvai') {
      if (!active) return 'Create a profile to earn XP';
      const xp = AI_XP[difficulty];
      return `Win = +${xp.win} XP · Draw +${xp.draw} · Loss +${xp.loss}${assistsAllowed && assists ? ' · hints cost XP' : ''}`;
    }
    const a = profileById(slotA);
    const b = profileById(slotB);
    if (!a && !b) return 'Guests don’t earn XP';
    if (a && b && a.id === b.id) return 'Same profile on both sides — no XP';
    const today = localDay(new Date());
    const winXp = (me: Profile, opp: Profile | undefined) => {
      const entry = me.pvpToday[opp?.id ?? GUEST];
      return pvpAward({
        outcome: 'win',
        reason: 'checkmate',
        moves: PVP_RULES.minMoves,
        sameProfile: false,
        gamesTodayBefore: entry?.date === today ? entry.count : 0,
        levelGap: opp ? me.level - opp.level : null,
      }).total;
    };
    const parts = [a && `${a.name} +${winXp(a, b)}`, b && `${b.name} +${winXp(b, a)}`].filter(
      Boolean,
    );
    return `Win = ${parts.join(' · ')} XP (from move ${PVP_RULES.minMoves})`;
  })();

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
        <div className="text-xs text-muted">
          <div>
            {mode === 'pvai'
              ? `${DIFFICULTIES[difficulty].label} · you play ${humanColor === 'random' ? 'a random side' : humanColor === 'w' ? 'White' : 'Black'}`
              : `${labelOf(slotA, nameA, 'Player 1')} vs ${labelOf(slotB, nameB, 'Player 2')}`}
          </div>
          <div className="mt-0.5 font-semibold text-accent-text" data-xp-preview>
            {xpPreview}
          </div>
        </div>
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
            {profiles.length > 0 && active && (
              <PlayerPicker
                label="You"
                profiles={profiles}
                value={active.id}
                onChange={setActive}
              />
            )}
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
            <PlayerPicker
              label="Player 1"
              profiles={profiles}
              value={slotA}
              onChange={setSlotA}
              allowGuest
              guestName={nameA}
              onGuestName={setNameA}
            />
            <PlayerPicker
              label="Player 2"
              profiles={profiles}
              value={slotB}
              onChange={setSlotB}
              allowGuest
              guestName={nameB}
              onGuestName={setNameB}
            />
            <div>
              <div className="mb-2 text-xs text-muted">Who plays White?</div>
              <Tabs<WhiteChoice>
                label="Who plays White"
                items={[
                  { id: 'a', label: labelOf(slotA, nameA, 'Player 1') },
                  { id: 'b', label: labelOf(slotB, nameB, 'Player 2') },
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
