import type { ReactNode } from 'react';
import { useWindowState } from '@/app/useWindowState';
import { BoardSwatch, LockIcon, PieceSetPreview } from '@/components/Cosmetics';
import { ScreenShell } from '@/components/ScreenShell';
import { Card, CardTitle, Tabs, Toggle } from '@/components/ui';
import { ACCENTS, type Accent, type ThemeMode } from '@shared/types';
import { BOARD_THEMES } from '@/config/boards';
import { PIECE_SETS } from '@/config/pieces';
import { unlockLevel, type RewardKind } from '@/config/rewards';
import { useActiveProfile, useCosmetics, useProfiles } from '@/store/profileStore';
import { useSettings } from '@/store/settingsStore';
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
            description="Also available with F11"
            checked={fullscreen}
            onChange={() => window.chessArena.window.toggleFullscreen()}
          />
        </Card>

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
      </div>
    </ScreenShell>
  );
}
