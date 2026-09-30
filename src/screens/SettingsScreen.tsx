import { useWindowState } from '@/app/useWindowState';
import { ScreenShell } from '@/components/ScreenShell';
import { Card, CardTitle, Tabs, Toggle } from '@/components/ui';
import { ACCENTS, type Accent, type ThemeMode } from '@shared/types';
import { PIECE_SETS } from '@/config/pieces';
import { useSettings } from '@/store/settingsStore';
import { cx } from '@/utils/format';

const ACCENT_SWATCH: Record<Accent, string> = {
  indigo: '#6366f1',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
};

export function SettingsScreen() {
  const { settings, update } = useSettings();
  const { fullscreen } = useWindowState();

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
          <div>
            <div className="mb-2 text-sm font-medium">Piece set</div>
            <Tabs
              label="Piece set"
              items={PIECE_SETS.map((p) => ({ id: p.id, label: p.name }))}
              value={settings.pieceSet}
              onChange={(pieceSet) => update({ pieceSet })}
            />
          </div>
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
