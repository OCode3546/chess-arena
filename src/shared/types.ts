/** Types shared by the main process, the preload bridge and the renderer. */

export type Color = 'w' | 'b';
export type Difficulty = 'beginner' | 'easy' | 'medium' | 'hard' | 'expert' | 'grandmaster';

export type ThemeMode = 'dark' | 'light';
export const ACCENTS = ['indigo', 'emerald', 'amber', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

export interface Settings {
  theme: ThemeMode;
  accent: Accent;
  sound: boolean;
  volume: number;
  animations: boolean;
  legalMoves: boolean;
  coordinates: boolean;
  autoQueen: boolean;
  colorBlindHighlights: boolean;
  autoUpdate: boolean;
  launchAtStartup: boolean;
  board: string;
  pieceSet: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'indigo',
  sound: true,
  volume: 0.7,
  animations: true,
  legalMoves: true,
  coordinates: true,
  autoQueen: false,
  colorBlindHighlights: false,
  autoUpdate: true,
  launchAtStartup: false,
  board: 'classic-wood',
  pieceSet: 'modern',
};

export interface TimeControl {
  id: string;
  /** Initial time per side in ms; 0 = untimed. */
  initialMs: number;
  incrementMs: number;
}

export interface PlayerInfo {
  name: string;
}

export interface GameSettings {
  mode: 'pvp' | 'pvai';
  timeControl: TimeControl;
  players: { w: PlayerInfo; b: PlayerInfo };
  autoFlip: boolean;
  difficulty?: Difficulty;
}

export interface SavedGame {
  fen: string;
  pgn: string;
  clocks: { w: number; b: number };
  settings: GameSettings;
  turn: Color;
  startedAt: string;
  /** True once White has moved and the clocks are live. */
  clockStarted: boolean;
}

export type LoadResult<T> = { ok: true; data: T | null } | { ok: false; error: 'corrupt' };

export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
}

/** The complete API the preload script exposes on `window.chessArena`. */
export interface ChessArenaApi {
  app: {
    getVersion(): Promise<string>;
    quit(): void;
    /** Storage files that were unreadable at startup and were reset. */
    getStartupIssues(): Promise<string[]>;
  };
  window: {
    minimize(): void;
    toggleMaximize(): void;
    toggleFullscreen(): void;
    close(): void;
    getState(): Promise<WindowState>;
    onStateChange(cb: (state: WindowState) => void): () => void;
    /** Fired when the user tries to close the window; answer with `confirmClose`. */
    onCloseRequested(cb: () => void): () => void;
    confirmClose(): void;
  };
  storage: {
    getSettings(): Promise<Settings>;
    setSettings(patch: Partial<Settings>): Promise<Settings>;
    getSavedGame(): Promise<LoadResult<SavedGame>>;
    setSavedGame(game: SavedGame): Promise<boolean>;
    clearSavedGame(): Promise<void>;
  };
}
