/** Types shared by the main process, the preload bridge and the renderer. */

import type { SearchRequest, SearchResult } from './uci';

export type { SearchRequest, SearchResult };

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
};

export interface TimeControl {
  id: string;
  /** Initial time per side in ms; 0 = untimed. */
  initialMs: number;
  incrementMs: number;
}

export interface PlayerInfo {
  name: string;
  /** Local profile playing this side; absent for guests and the computer. */
  profileId?: string;
}

export interface ProfileStats {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** Consecutive wins up to now. */
  streak: number;
  bestStreak: number;
  /** Local date (YYYY-MM-DD) of the last win vs the computer (first-win-of-the-day bonus). */
  lastWinDate?: string;
  winsByDifficulty: Record<Difficulty, number>;
  /** Fewest moves in a checkmate win. */
  fastestMate?: number;
}

/** Cosmetics a profile has chosen. Unlocks are derived from the level, never stored. */
export interface Equipped {
  board: string;
  pieceSet: string;
  frame: string;
  title?: string;
  /** Equipped effect ids (move trail, capture particles…). */
  effects: string[];
}

export const DEFAULT_EQUIPPED: Equipped = {
  board: 'classic-wood',
  pieceSet: 'modern',
  frame: 'none',
  effects: [],
};

export interface Profile {
  id: string;
  name: string;
  avatarId: string;
  level: number;
  /** Cumulative total. */
  xp: number;
  createdAt: string;
  stats: ProfileStats;
  /** Local games played today per opponent (profile id or 'guest'), for diminishing returns. */
  pvpToday: Record<string, { date: string; count: number }>;
  equipped: Equipped;
  /** Achievement id → ISO time it was earned. */
  achievements: Record<string, string>;
}

export interface ProfilesDoc {
  activeId: string | null;
  profiles: Profile[];
}

export type ResultCode = '1-0' | '0-1' | '1/2-1/2';

export interface GameRecord {
  id: string;
  /** ISO time the game ended. */
  date: string;
  mode: 'pvai' | 'pvp';
  /** Profile id, 'guest' or 'ai:<difficulty>'. */
  white: string;
  black: string;
  whiteName: string;
  blackName: string;
  pgn: string;
  result: ResultCode;
  reason: string;
  /** Full moves played. */
  moves: number;
  /** XP per profile id. */
  xpAwarded: Record<string, number>;
}

export interface GameSettings {
  mode: 'pvp' | 'pvai';
  timeControl: TimeControl;
  players: { w: PlayerInfo; b: PlayerInfo };
  autoFlip: boolean;
  /** vs AI only. */
  difficulty?: Difficulty;
  /** vs AI only: the side the human plays. */
  humanColor?: Color;
  /** vs AI only: hints and takebacks allowed (each costs XP). */
  assists?: boolean;
}

/** Hints and takebacks used in a vs-AI game (drives the XP penalty). */
export interface AssistsUsed {
  hints: number;
  undos: number;
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
  /** Absent in saves from before vs-AI support. */
  assists?: AssistsUsed;
}

export type EngineBackend = 'native' | 'wasm' | 'minimax';

export interface EngineStatus {
  /** Native Stockfish is running. */
  native: boolean;
  name?: string;
  error?: string;
  /** Fallback backends the renderer may use, in order. */
  fallbacks: Exclude<EngineBackend, 'native'>[];
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
    getProfiles(): Promise<ProfilesDoc>;
    /** Replaces all profiles; returns what was stored after validation. */
    setProfiles(doc: ProfilesDoc): Promise<ProfilesDoc>;
    /** Finished games, newest first. */
    getHistory(): Promise<GameRecord[]>;
    addGameRecord(record: GameRecord): Promise<boolean>;
  };
  engine: {
    /** Start (or report on) the native engine. */
    start(): Promise<EngineStatus>;
    /** Search with the native engine; rejects if it is unavailable or fails. */
    bestMove(req: SearchRequest): Promise<SearchResult>;
    /** Finish the current search early (its result is still delivered). */
    stop(): void;
  };
}
