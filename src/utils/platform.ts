/** Platform-dependent wording for the renderer (the app runs on Windows and macOS). */
export const isMac = typeof window !== 'undefined' && window.chessArena?.app.platform === 'darwin';

/** The computer, as users call it: "on this Mac" / "on this PC". */
export const COMPUTER = isMac ? 'Mac' : 'PC';

/** The command modifier key label. */
export const MOD_KEY = isMac ? 'Cmd' : 'Ctrl';

/** Keys that toggle fullscreen. */
export const FULLSCREEN_KEYS: string[] = isMac ? ['Ctrl', 'Cmd', 'F'] : ['F11'];
