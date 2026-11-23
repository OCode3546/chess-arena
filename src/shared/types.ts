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
  /** Online: show opponents' rematch offers (off = decline them automatically). */
  rematchOffers: boolean;
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
  rematchOffers: true,
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
  /** Online opponent: level and avatar as reported by the server. */
  level?: number;
  avatarId?: string;
}

/** Results of online games, kept apart from local ones. */
export interface OnlineStats {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** Local date (YYYY-MM-DD) of the last online win (first-online-win-of-the-day bonus). */
  lastWinDate?: string;
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
  online: OnlineStats;
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
  /** Online games played today per opponent (server-reported player id), for diminishing returns. */
  onlineToday: Record<string, { date: string; count: number }>;
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
  mode: 'pvai' | 'pvp' | 'online';
  /** Profile id, 'guest', 'ai:<difficulty>' or 'online:<opponent id>'. */
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
  /** Server game id of an online game. */
  onlineGameId?: string;
}

/** The local player's seat in an online game. */
export interface OnlineSeat {
  gameId: string;
  color: Color;
  /** The opponent's stable public id (anti-farming key); never their guest id. */
  opponentId: string;
}

export interface GameSettings {
  mode: 'pvp' | 'pvai' | 'online';
  timeControl: TimeControl;
  players: { w: PlayerInfo; b: PlayerInfo };
  autoFlip: boolean;
  /** vs AI only. */
  difficulty?: Difficulty;
  /** vs AI only: the side the human plays. */
  humanColor?: Color;
  /** vs AI only: hints and takebacks allowed (each costs XP). */
  assists?: boolean;
  /** Online only. Online games are never saved locally. */
  online?: OnlineSeat;
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

/** Per-install identity for online play (stored in userData). */
export interface OnlineIdentity {
  /** Random uuid sent to the server; never shown to other players. */
  guestId: string;
  /** Name opponents see; empty = the active profile's name. */
  displayName: string;
}

/** Enough to take a seat again in a live online game after a crash or relaunch. */
export interface OnlineRejoin {
  gameId: string;
  token: string;
  /** ISO time it was saved. */
  savedAt: string;
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

/** Outcome of writing a file chosen in a native Save dialog. */
export type SaveFileResult =
  | { status: 'saved'; fileName: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

export type ImportResult =
  | { status: 'imported'; profiles: number; games: number }
  | { status: 'canceled' }
  | { status: 'error'; message: string };

/**
 * How this copy of the app can update itself.
 * - `auto`: download in the background and install on restart (Windows installer, signed Mac app).
 * - `manual`: only tell the user and link to the download page (portable exe, unsigned Mac app).
 * - `none`: development build; updates are not checked.
 */
export type UpdateMode = 'auto' | 'manual' | 'none';

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; checkedAt: number }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string };

export interface UpdaterInfo {
  mode: UpdateMode;
  state: UpdateState;
  /** Page where a new version can be downloaded by hand. */
  releasesUrl: string;
}

/** License texts bundled in `LICENSES/` that the About screen can show. */
export const LICENSE_IDS = ['stockfish', 'gpl-2', 'chess-js', 'inter', 'space-grotesk'] as const;
export type LicenseId = (typeof LICENSE_IDS)[number];

/** The complete API the preload script exposes on `window.chessArena`. */
export interface ChessArenaApi {
  app: {
    /** The OS the app runs on (`win32`, `darwin`, `linux`). */
    platform: string;
    getVersion(): Promise<string>;
    quit(): void;
    /** Main-process requests to show a screen (e.g. the macOS "Settings…" menu item). */
    onNavigate(cb: (path: string) => void): () => void;
    /** Storage files that were unreadable at startup and were reset. */
    getStartupIssues(): Promise<string[]>;
    /** Show the user-data folder in the system file manager. */
    openDataFolder(): void;
    getLicense(id: LicenseId): Promise<string>;
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
    /**
     * Put every profile back to level 1 (names and avatars stay) and delete the game
     * history and the saved game. Returns the profiles as stored.
     */
    resetProgress(): Promise<ProfilesDoc>;
  };
  /** Native file dialogs. The main process picks and writes the files; no paths cross IPC. */
  dialog: {
    /** Save a finished game from the history as a .pgn file. */
    exportPgn(gameId: string): Promise<SaveFileResult>;
    /** Save profiles, history and settings as a backup file. */
    exportData(): Promise<SaveFileResult>;
    /** Replace profiles, history and settings with a backup file's. */
    importData(): Promise<ImportResult>;
  };
  engine: {
    /** Start (or report on) the native engine. */
    start(): Promise<EngineStatus>;
    /** Search with the native engine; rejects if it is unavailable or fails. */
    bestMove(req: SearchRequest): Promise<SearchResult>;
    /** Finish the current search early (its result is still delivered). */
    stop(): void;
  };
  online: {
    /** Game server WebSocket URL, fixed at build time. */
    serverUrl: string;
    getIdentity(): Promise<OnlineIdentity>;
    /** Returns the identity as stored (the name is trimmed and length-limited). */
    setDisplayName(name: string): Promise<OnlineIdentity>;
    getRejoin(): Promise<OnlineRejoin | null>;
    setRejoin(rejoin: OnlineRejoin): Promise<boolean>;
    clearRejoin(): Promise<void>;
  };
  updater: {
    getInfo(): Promise<UpdaterInfo>;
    /** Look for a newer release now (in `auto` mode with auto-update on, it also downloads). */
    check(): void;
    /** Start downloading an available update (`auto` mode). */
    download(): void;
    /** Quit and install a downloaded update. The renderer saves any game first. */
    install(): void;
    onChange(cb: (info: UpdaterInfo) => void): () => void;
  };
}
