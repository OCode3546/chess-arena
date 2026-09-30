import type { Migration } from '@shared/migrate';
import { isGameRecord, sanitizeProfilesDoc, sanitizeSettings } from '@shared/validate';

export const SCHEMA_VERSION = 2;

export interface StorageMigrations {
  settings: Record<number, Migration>;
  savegame: Record<number, Migration>;
  profiles: Record<number, Migration>;
  history: Record<number, Migration>;
}

type Doc = Record<string, unknown>;
const asDoc = (v: unknown): Doc => (typeof v === 'object' && v !== null ? (v as Doc) : {});

/**
 * Per-store migrations, keyed by the schema version they upgrade *to*. Run the settings
 * migrations before the profile ones: v2 moves the board and piece set chosen in Settings
 * onto every existing profile (cosmetics became per-profile unlocks).
 */
export function storageMigrations(): StorageMigrations {
  let legacyLook: Doc = {};
  return {
    settings: {
      1: (d) => ({ ...d, settings: sanitizeSettings(d.settings) }),
      2: (d) => {
        const s = asDoc(d.settings);
        legacyLook = { board: s.board, pieceSet: s.pieceSet };
        return { ...d, settings: sanitizeSettings(s) };
      },
    },
    savegame: {
      1: (d) => ({ ...d, game: d.game ?? null }),
    },
    profiles: {
      1: (d) => ({ ...d, ...sanitizeProfilesDoc(d) }),
      2: (d) => {
        const profiles = Array.isArray(d.profiles)
          ? d.profiles.map((p) =>
              'equipped' in asDoc(p) ? p : { ...asDoc(p), equipped: { ...legacyLook } },
            )
          : [];
        return { ...d, ...sanitizeProfilesDoc({ ...d, profiles }) };
      },
    },
    history: {
      1: (d) => ({ ...d, games: Array.isArray(d.games) ? d.games.filter(isGameRecord) : [] }),
    },
  };
}
