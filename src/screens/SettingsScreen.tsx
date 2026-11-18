import { useId, useState, type ReactNode } from 'react';
import { useWindowState } from '@/app/useWindowState';
import { playSound } from '@/audio/sfx';
import { BoardSwatch, LockIcon, PieceSetPreview } from '@/components/Cosmetics';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, CardTitle, Modal, Tabs, Toggle } from '@/components/ui';
import { ACCENTS, type Accent, type ThemeMode } from '@shared/types';
import { BOARD_THEMES } from '@/config/boards';
import { PIECE_SETS } from '@/config/pieces';
import { unlockLevel, type RewardKind } from '@/config/rewards';
import { exportData, importData, resetProgress } from '@/store/dataActions';
import { useActiveProfile, useCosmetics, useProfiles } from '@/store/profileStore';
import { useSettings } from '@/store/settingsStore';
import { installUpdate, openReleasesPage, useUpdates } from '@/store/updateStore';
import { COMPUTER, FULLSCREEN_KEYS, isMac } from '@/utils/platform';
import { cx } from '@/utils/format';

const ACCENT_SWATCH: Record<Accent, string> = {
  indigo: '#6366f1',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
};

/** Radio row of cosmetics for the active profile; locked ones show the level that unlocks them. */
function CosmeticPicker({
  label,
  kind,
  items,
  value,
}: {
  label: string;
  kind: RewardKind;
  items: { id: string; name: string; preview: ReactNode }[];
  value: string;
}) {
  const profile = useActiveProfile();
  const equip = useProfiles((s) => s.equip);
  return (
    <div>
      <div className="mb-2 text-sm font-medium">{label}</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {items.map((item) => {
          const needed = unlockLevel(kind, item.id) ?? 1;
          const locked = !profile || needed > profile.level;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={value === item.id}
              aria-label={locked ? `${item.name}, unlocks at level ${needed}` : item.name}
              title={locked ? `${item.name} · unlocks at Lv ${needed}` : item.name}
              disabled={locked}
              onClick={() => equip(kind, item.id)}
              className={cx(
                'relative cursor-pointer rounded-xl p-1 ring-2 transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed',
                value === item.id ? 'ring-accent-soft' : 'ring-transparent',
              )}
            >
              <div className={cx(locked && 'opacity-35 grayscale')}>{item.preview}</div>
              {locked && (
                <span className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-0.5 rounded-b-lg bg-black/60 py-0.5 text-[10px] font-semibold text-white">
                  <LockIcon className="h-2.5 w-2.5" /> Lv {needed}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A labelled row with a control on the right, laid out like a Toggle. */
function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="text-sm font-medium text-fg">{label}</div>
        {description && <div className="text-xs text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SoundSettings() {
  const { settings, update } = useSettings();
  const sliderId = useId();
  // The slider moves freely; the value is saved (and previewed) when it is released.
  const [draft, setDraft] = useState<number | null>(null);
  const percent = Math.round((draft ?? settings.volume) * 100);
  const commit = () => {
    if (draft === null) return;
    update({ volume: draft });
    setDraft(null);
    playSound('move');
  };
  return (
    <Card className="flex flex-col">
      <CardTitle className="mb-2">Sound</CardTitle>
      <Toggle
        label="Sound effects"
        description="Moves, captures, checks, results and level-ups"
        checked={settings.sound}
        onChange={(sound) => {
          update({ sound });
          if (sound) playSound('move');
        }}
      />
      <div className={cx('flex items-center gap-3 py-2', !settings.sound && 'opacity-50')}>
        <label htmlFor={sliderId} className="w-16 shrink-0 text-sm font-medium">
          Volume
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={percent}
          disabled={!settings.sound}
          aria-valuetext={`${percent}%`}
          onChange={(e) => setDraft(Number(e.target.value) / 100)}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="h-1.5 flex-1 cursor-pointer accent-(--accent) disabled:cursor-not-allowed"
        />
        <span className="w-10 text-right text-sm text-muted tabular-nums">{percent}%</span>
      </div>
    </Card>
  );
}

/** "Check for updates" row: current status plus the next action for this kind of build. */
function UpdateRow() {
  const { mode, state } = useUpdates((s) => s.info);
  const updater = window.chessArena.updater;

  if (mode === 'none') {
    return (
      <SettingRow label="Check for updates" description="Available in installed release builds">
        <Button size="sm" disabled>
          Check now
        </Button>
      </SettingRow>
    );
  }

  let description: string;
  let action = (
    <Button size="sm" onClick={() => updater.check()}>
      Check now
    </Button>
  );
  switch (state.status) {
    case 'checking':
      description = 'Checking…';
      action = (
        <Button size="sm" disabled>
          Check now
        </Button>
      );
      break;
    case 'up-to-date':
      description = 'You have the latest version';
      break;
    case 'available':
      description = `Version ${state.version} is available`;
      action =
        mode === 'manual' ? (
          <Button size="sm" variant="primary" onClick={openReleasesPage}>
            Download
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => updater.download()}>
            Update
          </Button>
        );
      break;
    case 'downloading':
      description = `Downloading ${state.version}… ${state.percent}%`;
      action = (
        <Button size="sm" disabled>
          Update
        </Button>
      );
      break;
    case 'downloaded':
      description = `Version ${state.version} is ready to install`;
      action = (
        <Button size="sm" variant="primary" onClick={installUpdate}>
          Restart &amp; update
        </Button>
      );
      break;
    case 'error':
      description = state.message;
      break;
    default:
      description =
        mode === 'manual'
          ? 'New versions are downloaded from the Chess Arena website'
          : 'Look for a newer version now';
  }
  return (
    <SettingRow label="Check for updates" description={description}>
      {action}
    </SettingRow>
  );
}

type Confirm = null | 'import' | 'reset';

function AppSettings() {
  const { settings, update } = useSettings();
  const updateMode = useUpdates((s) => s.info.mode);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>) => {
    setConfirm(null);
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="col-span-2">
      <CardTitle className="mb-2">App</CardTitle>
      <div className="grid grid-cols-2 gap-x-10">
        <div>
          <Toggle
            label="Update automatically"
            description={
              updateMode === 'manual'
                ? 'Check for new versions when the app starts'
                : 'Download new versions in the background'
            }
            checked={settings.autoUpdate}
            onChange={(autoUpdate) => update({ autoUpdate })}
          />
          <UpdateRow />
          <Toggle
            label="Launch at startup"
            description={`Open Chess Arena when you sign in to ${isMac ? 'your Mac' : 'Windows'}`}
            checked={settings.launchAtStartup}
            onChange={(launchAtStartup) => update({ launchAtStartup })}
          />
          <SettingRow label="Data folder" description="Where your profiles and games are stored">
            <Button size="sm" onClick={() => window.chessArena.app.openDataFolder()}>
              Open folder
            </Button>
          </SettingRow>
        </div>
        <div>
          <SettingRow label="Export data" description="Profiles, history and settings in one file">
            <Button size="sm" disabled={busy} onClick={() => void run(exportData)}>
              Export…
            </Button>
          </SettingRow>
          <SettingRow label="Import data" description="Restore a file made with Export">
            <Button size="sm" disabled={busy} onClick={() => setConfirm('import')}>
              Import…
            </Button>
          </SettingRow>
          <SettingRow
            label="Reset progress"
            description="All profiles back to level 1; history is deleted"
          >
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirm('reset')}>
              Reset…
            </Button>
          </SettingRow>
        </div>
      </div>

      <Modal
        open={confirm === 'import'}
        title="Import data?"
        onClose={() => setConfirm(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} data-autofocus>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void run(importData)}>
              Choose file…
            </Button>
          </>
        }
      >
        The profiles, game history and settings on this {COMPUTER} will be <b>replaced</b> by the
        ones in the backup file. Export first if you want to keep the current data.
      </Modal>

      <Modal
        open={confirm === 'reset'}
        title="Reset all progress?"
        onClose={() => setConfirm(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)} data-autofocus>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void run(resetProgress)}>
              Reset progress
            </Button>
          </>
        }
      >
        Every profile goes back to level 1 with no XP, stats, achievements or equipped rewards. The
        game history and any saved game are deleted. Profile names, avatars and settings are kept.
        <p className="mt-2 font-semibold text-danger">This cannot be undone.</p>
      </Modal>
    </Card>
  );
}

export function SettingsScreen() {
  const { settings, update } = useSettings();
  const { fullscreen } = useWindowState();
  const look = useCosmetics();

  return (
    <ScreenShell
      id="settings"
      title="Settings"
      subtitle="Changes apply instantly and are saved automatically"
    >
      <div className="grid grid-cols-2 gap-4">
        <Card className="flex flex-col gap-4">
          <CardTitle>Appearance</CardTitle>
          <div>
            <div className="mb-2 text-sm font-medium">Theme</div>
            <Tabs<ThemeMode>
              label="Theme"
              items={[
                { id: 'dark', label: 'Dark' },
                { id: 'light', label: 'Light' },
              ]}
              value={settings.theme}
              onChange={(theme) => update({ theme })}
            />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Accent colour</div>
            <div className="flex gap-3" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={settings.accent === a}
                  aria-label={a}
                  title={a}
                  onClick={() => update({ accent: a })}
                  className={cx(
                    'h-9 w-9 cursor-pointer rounded-full ring-offset-2 ring-offset-bg transition-transform hover:scale-110',
                    settings.accent === a && 'ring-2 ring-fg',
                  )}
                  style={{ background: ACCENT_SWATCH[a] }}
                />
              ))}
            </div>
          </div>
          <CosmeticPicker
            label="Board theme"
            kind="board"
            value={look.board}
            items={BOARD_THEMES.map((b) => ({
              id: b.id,
              name: b.name,
              preview: <BoardSwatch id={b.id} pieceSet={look.pieceSet} size={44} />,
            }))}
          />
          <CosmeticPicker
            label="Piece set"
            kind="pieceSet"
            value={look.pieceSet}
            items={PIECE_SETS.map((p) => ({
              id: p.id,
              name: p.name,
              preview: <PieceSetPreview id={p.id} size={44} />,
            }))}
          />
          <Toggle
            label="Fullscreen"
            description={`Also available with ${FULLSCREEN_KEYS.join('+')}`}
            checked={fullscreen}
            onChange={() => window.chessArena.window.toggleFullscreen()}
          />
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="flex flex-col">
            <CardTitle className="mb-2">Gameplay</CardTitle>
            <Toggle
              label="Show legal moves"
              checked={settings.legalMoves}
              onChange={(legalMoves) => update({ legalMoves })}
            />
            <Toggle
              label="Board coordinates"
              checked={settings.coordinates}
              onChange={(coordinates) => update({ coordinates })}
            />
            <Toggle
              label="Auto-queen"
              description="Promote to a queen without asking"
              checked={settings.autoQueen}
              onChange={(autoQueen) => update({ autoQueen })}
            />
            <Toggle
              label="Animations"
              description="Piece movement and effects"
              checked={settings.animations}
              onChange={(animations) => update({ animations })}
            />
            <Toggle
              label="Colour-blind highlights"
              description="Blue/orange highlights instead of yellow/green"
              checked={settings.colorBlindHighlights}
              onChange={(colorBlindHighlights) => update({ colorBlindHighlights })}
            />
          </Card>
          <SoundSettings />
        </div>

        <AppSettings />
      </div>
    </ScreenShell>
  );
}
