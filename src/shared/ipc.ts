/** IPC channel names. Keep in sync between main and preload. */
export const IPC = {
  appVersion: 'app:version',
  appQuit: 'app:quit',
  appStartupIssues: 'app:startup-issues',
  winMinimize: 'window:minimize',
  winToggleMaximize: 'window:toggle-maximize',
  winToggleFullscreen: 'window:toggle-fullscreen',
  winClose: 'window:close',
  winGetState: 'window:get-state',
  winStateChanged: 'window:state-changed',
  winCloseRequested: 'window:close-requested',
  winConfirmClose: 'window:confirm-close',
  settingsGet: 'storage:settings-get',
  settingsSet: 'storage:settings-set',
  savedGameGet: 'storage:saved-game-get',
  savedGameSet: 'storage:saved-game-set',
  savedGameClear: 'storage:saved-game-clear',
} as const;
