import { create } from 'zustand';
import {
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type GameAction,
  type GameState as ServerState,
  type OnlineEndReason,
  type OnlineResult,
  type PlayerInfo as NetPlayer,
  type ServerMsg,
  type Side,
  type TimeControl as NetTimeControl,
} from '@shared/protocol';
import type { GameSettings, OnlineIdentity, OnlineRejoin, PlayerInfo } from '@shared/types';
import { cosmeticsFor } from '@/config/rewards';
import { setOnlineMoveSink, useGameStore, type OnlineSnapshot } from '@/store/gameStore';
import { selectActiveProfile, useProfiles } from '@/store/profileStore';
import { useSettings } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { Connection, type ConnStatus, type HelloInfo } from './connection';

export type Lobby =
  | { kind: 'idle' }
  /** Waiting for the server to answer a request. */
  | { kind: 'pending'; action: 'queue' | 'create' | 'join' }
  /** `since` is local time. */
  | { kind: 'queue'; tc: NetTimeControl; since: number }
  /** `expiresAt` is local time. */
  | { kind: 'room'; code: string; tc: NetTimeControl; expiresAt: number };

export type RematchState = 'none' | 'sent' | 'received' | 'declined' | 'unavailable';

export interface OnlineOutcome {
  result: OnlineResult;
  winner: Side | null;
  reason: OnlineEndReason;
  pgn: string;
  plies: number;
}

export interface LiveGame {
  gameId: string;
  token: string;
  color: Side;
  tc: NetTimeControl;
  white: NetPlayer;
  black: NetPlayer;
  /** Local profile credited with the result (the active one when the game started). */
  profileId: string | null;
  /** Last state from the server (null until the first arrives). */
  state: ServerState | null;
  /** Local time at which `state` was measured by the server. */
  anchor: number;
  /** `graceEndsAt` is local time. */
  opponent: { connected: boolean; graceEndsAt: number | null };
  over: OnlineOutcome | null;
  rematch: RematchState;
}

interface OnlineState {
  status: ConnStatus;
  statusDetail: string | null;
  lobby: Lobby;
  lobbyError: string | null;
  game: LiveGame | null;
  /** A live game this install can take its seat in again (saved across restarts). */
  rejoin: OnlineRejoin | null;
  identity: OnlineIdentity | null;
  /** Bumped whenever a new online game is put on the board (screens navigate to it). */
  shownGame: string | null;

  /** Load the identity and any saved rejoin info (at startup). */
  init(): Promise<void>;
  /** Connect and stay connected. */
  connect(): Promise<void>;
  retry(): void;
  findMatch(tc: NetTimeControl): void;
  cancelSearch(): void;
  createRoom(tc: NetTimeControl, color: Side | 'random'): void;
  cancelRoom(): void;
  /** Returns an error message if the code is malformed. */
  joinRoom(code: string): string | null;
  clearLobbyError(): void;
  /** Take the saved seat again (Home → "Rejoin online game"). */
  rejoinSaved(): Promise<void>;
  /** Resign, abort, draw offers… for the live game. */
  act(
    action: Exclude<GameAction, 'game.rematch' | 'game.rematchAccept' | 'game.rematchDecline'>,
  ): void;
  /** Offer a rematch, or accept the opponent's. */
  rematch(): void;
  declineRematch(): void;
  /** Put the online game back on the board (after a local game was shown). */
  showGame(): boolean;
  setDisplayName(name: string): Promise<void>;
}

/** What was last asked of the server, so errors without a game id can be routed. */
let lastRequest: 'queue' | 'create' | 'join' | 'rejoin' | 'rematch' | null = null;
let conn: Connection | null = null;
let appVersion = '0.0.0';
/** The saved seat to take once connected. */
let wantRejoin: OnlineRejoin | null = null;
/** Increments with every welcome; an unconfirmed move is re-sent once per connection. */
let epoch = 0;
let pendingSentEpoch = -1;
let roomCheck: unknown = null;

const NO_LOBBY: Lobby = { kind: 'idle' };

function helloInfo(): HelloInfo {
  const { identity } = useOnline.getState();
  const profile = selectActiveProfile(useProfiles.getState());
  return {
    appVersion,
    player: {
      guestId: identity!.guestId,
      name: identity?.displayName || profile?.name || 'Player',
      level: profile?.level ?? 1,
      avatarId: profile ? cosmeticsFor(profile).avatarId : 'knight-indigo',
    },
  };
}

const opponentOf = (g: LiveGame): NetPlayer => (g.color === 'w' ? g.black : g.white);

/** Game settings for showing an online game with the existing board and panels. */
export function onlineSettings(g: LiveGame): GameSettings {
  const player = (side: Side): PlayerInfo => {
    const info = side === 'w' ? g.white : g.black;
    return side === g.color
      ? { name: info.name, ...(g.profileId && { profileId: g.profileId }) }
      : { name: info.name, level: info.level, avatarId: info.avatarId };
  };
  return {
    mode: 'online',
    timeControl: {
      id: `online-${g.tc.baseMs}+${g.tc.incMs}`,
      initialMs: g.tc.baseMs,
      incrementMs: g.tc.incMs,
    },
    players: { w: player('w'), b: player('b') },
    autoFlip: false,
    online: { gameId: g.gameId, color: g.color, opponentId: opponentOf(g).id },
  };
}

const snapshotOf = (g: LiveGame): OnlineSnapshot | null =>
  g.state && {
    moves: g.state.moves,
    clocks: g.state.clocks,
    clockRunning: g.state.clockRunning,
    anchor: g.anchor,
  };

const isRoomCode = (code: string) =>
  code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));

function send(msg: Parameters<Connection['send']>[0]): boolean {
  if (conn?.send(msg)) return true;
  useOnline.setState({ lobbyError: "Can't reach the server right now." });
  return false;
}

export const useOnline = create<OnlineState>()((set, get) => {
  const saveRejoin = (r: OnlineRejoin | null) => {
    set({ rejoin: r });
    if (r) void window.chessArena.online.setRejoin(r);
    else void window.chessArena.online.clearRejoin();
  };

  const patchGame = (gameId: string, patch: Partial<LiveGame>) => {
    const g = get().game;
    if (g && g.gameId === gameId) set({ game: { ...g, ...patch } });
  };

  /** Put a game on the board from the latest server state. */
  const putOnBoard = (g: LiveGame): boolean => {
    const snap = snapshotOf(g);
    if (!snap) return false;
    const board = useGameStore.getState();
    if (!board.startOnline(onlineSettings(g), snap)) return false;
    if (g.over) board.finishOnline(g.gameId, g.over);
    set({ shownGame: g.gameId });
    return true;
  };

  const onWelcome = () => {
    epoch++;
    const { game, lobby } = get();
    if (game && !game.over) {
      lastRequest = 'rejoin';
      conn!.send({ t: 'game.rejoin', gameId: game.gameId, token: game.token });
    } else if (wantRejoin) {
      lastRequest = 'rejoin';
      conn!.send({ t: 'game.rejoin', gameId: wantRejoin.gameId, token: wantRejoin.token });
    }
    if (lobby.kind === 'queue') {
      // The server forgets the queue on disconnect: join again (keeping our own start time).
      lastRequest = 'queue';
      conn!.send({ t: 'queue.join', tc: lobby.tc });
    } else if (lobby.kind === 'pending') {
      set({ lobby: NO_LOBBY });
    } else if (lobby.kind === 'room') {
      // A host back within a minute gets `room.created` again right after the welcome.
      if (roomCheck !== null) window.clearTimeout(roomCheck as number);
      const code = lobby.code;
      roomCheck = window.setTimeout(() => {
        roomCheck = null;
        const l = get().lobby;
        if (l.kind === 'room' && l.code === code) {
          set({ lobby: NO_LOBBY, lobbyError: 'Your invite code expired while you were offline.' });
        }
      }, 3_000);
    }
  };

  const onError = (msg: Extract<ServerMsg, { t: 'error' }>) => {
    const g = get().game;
    if (msg.gameId) {
      if (!g || g.gameId !== msg.gameId) return;
      const board = useGameStore.getState();
      const snap = snapshotOf(g);
      if (board.online?.pending && snap) {
        // Our move was refused: take it back (a fresh state usually follows too).
        board.syncOnline(g.gameId, snap, { discardPending: true });
      }
      toast(msg.message, 'warning');
      return;
    }
    const req = lastRequest;
    lastRequest = null;
    switch (req) {
      case 'queue':
      case 'create':
      case 'join':
        set({ lobby: NO_LOBBY, lobbyError: msg.message });
        return;
      case 'rejoin':
        if (wantRejoin || get().rejoin) {
          wantRejoin = null;
          saveRejoin(null);
          toast('That online game has already ended.', 'info');
        }
        if (g && !g.over) {
          // The server no longer has our live game (e.g. it restarted).
          set({
            game: {
              ...g,
              over: {
                result: '*',
                winner: null,
                reason: 'server-shutdown',
                pgn: '',
                plies: g.state?.seq ?? 0,
              },
            },
          });
          useGameStore.getState().finishOnline(g.gameId, {
            result: '*',
            winner: null,
            reason: 'server-shutdown',
          });
        }
        return;
      case 'rematch':
        if (g) set({ game: { ...g, rematch: 'unavailable' } });
        toast(msg.message, 'info');
        return;
      default:
        toast(msg.message, 'warning');
    }
  };

  const onMessage = (msg: ServerMsg) => {
    switch (msg.t) {
      case 'welcome':
        onWelcome();
        return;
      case 'room.created': {
        if (roomCheck !== null) window.clearTimeout(roomCheck as number);
        roomCheck = null;
        if (lastRequest === 'create') lastRequest = null;
        const expiresAt = conn!.clock.toLocal(msg.expiresAt);
        set({ lobby: { kind: 'room', code: msg.code, tc: msg.tc, expiresAt }, lobbyError: null });
        return;
      }
      case 'room.closed': {
        const l = get().lobby;
        if (l.kind !== 'room' || l.code !== msg.code) return;
        set({
          lobby: NO_LOBBY,
          lobbyError:
            msg.reason === 'expired' ? 'Your invite code expired. Create a new one.' : null,
        });
        return;
      }
      case 'queue.waiting': {
        if (lastRequest === 'queue') lastRequest = null;
        const l = get().lobby;
        const keep =
          l.kind === 'queue' && l.tc.baseMs === msg.tc.baseMs && l.tc.incMs === msg.tc.incMs;
        set({
          lobby: { kind: 'queue', tc: msg.tc, since: keep ? l.since : Date.now() },
          lobbyError: null,
        });
        return;
      }
      case 'queue.left':
        if (get().lobby.kind === 'queue') set({ lobby: NO_LOBBY });
        return;
      case 'game.start': {
        const g = get().game;
        if (g && g.gameId === msg.gameId) {
          // Back in a game we already know (a reconnect): the board stays as it is.
          if (lastRequest === 'rejoin') lastRequest = null;
          patchGame(msg.gameId, { token: msg.token, white: msg.white, black: msg.black });
          return;
        }
        lastRequest = null;
        wantRejoin = null;
        pendingSentEpoch = -1;
        const profile = selectActiveProfile(useProfiles.getState());
        set({
          lobby: NO_LOBBY,
          lobbyError: null,
          game: {
            gameId: msg.gameId,
            token: msg.token,
            color: msg.color,
            tc: msg.tc,
            white: msg.white,
            black: msg.black,
            profileId: profile?.id ?? null,
            state: null,
            anchor: 0,
            opponent: { connected: true, graceEndsAt: null },
            over: null,
            rematch: 'none',
          },
        });
        saveRejoin({ gameId: msg.gameId, token: msg.token, savedAt: new Date().toISOString() });
        return;
      }
      case 'game.state': {
        const g = get().game;
        if (!g || g.gameId !== msg.gameId) return;
        const { t: _t, ...state } = msg;
        const next: LiveGame = { ...g, state, anchor: conn!.clock.toLocal(msg.serverTs) };
        set({ game: next });
        const board = useGameStore.getState();
        if (!g.state) {
          putOnBoard(next);
          return;
        }
        board.syncOnline(g.gameId, snapshotOf(next)!);
        // A move we made while the link was down: send it now that we are back.
        const pending = useGameStore.getState().online?.pending;
        if (pending && pending.seq === msg.seq && pendingSentEpoch !== epoch) {
          pendingSentEpoch = epoch;
          conn!.send({ t: 'game.move', gameId: g.gameId, uci: pending.uci, seq: pending.seq });
        }
        return;
      }
      case 'game.opponentStatus': {
        const graceEndsAt = msg.graceEndsAt === null ? null : conn!.clock.toLocal(msg.graceEndsAt);
        patchGame(msg.gameId, { opponent: { connected: msg.connected, graceEndsAt } });
        return;
      }
      case 'game.over': {
        const g = get().game;
        if (!g || g.gameId !== msg.gameId) return;
        const over: OnlineOutcome = {
          result: msg.result,
          winner: msg.winner,
          reason: msg.reason,
          pgn: msg.pgn,
          plies: msg.plies,
        };
        set({
          game: { ...g, over, opponent: { ...g.opponent, graceEndsAt: null } },
        });
        const result = { result: msg.result, winner: msg.winner, reason: msg.reason };
        // Only touches the board if it shows this game (not a local game played meanwhile).
        useGameStore.getState().finishOnline(g.gameId, result);
        useProfiles.getState().settleOnlineGame({
          gameId: g.gameId,
          profileId: g.profileId,
          color: g.color,
          players: { w: { name: g.white.name }, b: { name: g.black.name } },
          opponentId: opponentOf(g).id,
          result,
          plies: msg.plies,
          pgn: msg.pgn,
        });
        if (get().rejoin?.gameId === g.gameId) saveRejoin(null);
        return;
      }
      case 'game.rematchOffer': {
        const g = get().game;
        if (!g || g.gameId !== msg.gameId) return;
        if (!useSettings.getState().settings.rematchOffers) {
          conn!.send({ t: 'game.rematchDecline', gameId: g.gameId });
          return;
        }
        patchGame(g.gameId, { rematch: 'received' });
        toast(`${opponentOf(g).name} wants a rematch.`, 'info');
        return;
      }
      case 'game.rematchDeclined':
        if (lastRequest === 'rematch') lastRequest = null;
        patchGame(msg.gameId, { rematch: 'declined' });
        return;
      case 'error':
        onError(msg);
        return;
      default:
        return;
    }
  };

  return {
    status: 'idle',
    statusDetail: null,
    lobby: NO_LOBBY,
    lobbyError: null,
    game: null,
    rejoin: null,
    identity: null,
    shownGame: null,

    async init() {
      const api = window.chessArena;
      const [identity, rejoin, version] = await Promise.all([
        api.online.getIdentity(),
        api.online.getRejoin(),
        api.app.getVersion(),
      ]);
      appVersion = version;
      set({ identity, rejoin });
    },

    async connect() {
      if (!get().identity) await get().init();
      if (!conn) {
        conn = new Connection(window.chessArena.online.serverUrl, helloInfo, {
          status: (status, statusDetail) => set({ status, statusDetail }),
          message: onMessage,
        });
      }
      conn.start();
    },

    retry() {
      conn?.retryNow();
    },

    findMatch(tc) {
      lastRequest = 'queue';
      if (send({ t: 'queue.join', tc })) {
        set({ lobby: { kind: 'pending', action: 'queue' }, lobbyError: null });
      }
    },

    cancelSearch() {
      conn?.send({ t: 'queue.leave' });
      set({ lobby: NO_LOBBY });
    },

    createRoom(tc, color) {
      lastRequest = 'create';
      if (send({ t: 'room.create', tc, color })) {
        set({ lobby: { kind: 'pending', action: 'create' }, lobbyError: null });
      }
    },

    cancelRoom() {
      conn?.send({ t: 'room.cancel' });
      set({ lobby: NO_LOBBY });
    },

    joinRoom(raw) {
      const code = normalizeRoomCode(raw);
      if (!isRoomCode(code)) {
        return `Invite codes are ${ROOM_CODE_LENGTH} letters and digits, like K7QM2X.`;
      }
      lastRequest = 'join';
      if (send({ t: 'room.join', code })) {
        set({ lobby: { kind: 'pending', action: 'join' }, lobbyError: null });
      }
      return null;
    },

    clearLobbyError() {
      set({ lobbyError: null });
    },

    async rejoinSaved() {
      const r = get().rejoin;
      if (!r) return;
      const g = get().game;
      if (g && g.gameId === r.gameId) {
        get().showGame();
        return;
      }
      wantRejoin = r;
      await get().connect();
      if (conn?.isOnline) {
        lastRequest = 'rejoin';
        conn.send({ t: 'game.rejoin', gameId: r.gameId, token: r.token });
      }
    },

    act(action) {
      const g = get().game;
      if (!g) return;
      if (!conn?.send({ t: action, gameId: g.gameId })) {
        toast('Not connected — try again in a moment.', 'warning');
      }
    },

    rematch() {
      const g = get().game;
      if (!g?.over) return;
      lastRequest = 'rematch';
      const t = g.rematch === 'received' ? 'game.rematchAccept' : 'game.rematch';
      if (conn?.send({ t, gameId: g.gameId })) patchGame(g.gameId, { rematch: 'sent' });
      else toast('Not connected — try again in a moment.', 'warning');
    },

    declineRematch() {
      const g = get().game;
      if (!g || g.rematch !== 'received') return;
      conn?.send({ t: 'game.rematchDecline', gameId: g.gameId });
      patchGame(g.gameId, { rematch: 'none' });
    },

    showGame() {
      const g = get().game;
      if (!g) return false;
      const board = useGameStore.getState();
      if (board.settings?.online?.gameId === g.gameId) return true;
      return putOnBoard(g);
    },

    async setDisplayName(name) {
      const identity = await window.chessArena.online.setDisplayName(name);
      set({ identity });
      // The server learns names from the hello: say it again if nothing is going on.
      const { game, lobby } = get();
      if (conn?.isOnline && (!game || game.over) && lobby.kind === 'idle') conn.restart();
    },
  };
});

/** Called by the game store for each of our moves. */
function sendOnlineMove(gameId: string, uci: string, seq: number): void {
  if (conn?.send({ t: 'game.move', gameId, uci, seq })) pendingSentEpoch = epoch;
}

/** Send the local player's online moves, and follow the OS's network status. */
export function wireOnline(): () => void {
  setOnlineMoveSink(sendOnlineMove);
  const onOnline = () => conn?.retryNow();
  const onOffline = () => conn?.linkLost();
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    setOnlineMoveSink(null);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
