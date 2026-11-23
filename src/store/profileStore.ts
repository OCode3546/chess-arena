import { useMemo } from 'react';
import { create } from 'zustand';
import type { GameRecord, Profile, ProfilesDoc } from '@shared/types';
import { MAX_PROFILES } from '@shared/validate';
import { cosmeticsFor, isUnlocked, type Cosmetics, type RewardKind } from '@/config/rewards';
import { levelForXp } from '@/progression/levels';
import {
  newProfile,
  settleMatch,
  settleOnlineMatch,
  type FinishedOnlineGame,
  type PlayerAward,
} from '@/progression/match';
import { currentPgn, useGameStore } from './gameStore';

export interface ProfilePersistence {
  saveProfiles(doc: ProfilesDoc): void;
  addRecord(record: GameRecord): void;
}

let persistence: ProfilePersistence | null = null;
/** Wire the store to disk (the renderer passes the IPC-backed implementation). */
export function setProfilePersistence(p: ProfilePersistence | null): void {
  persistence = p;
}

export interface LastMatch {
  /** `startedAt` of the local game (or the server id of the online game) these awards belong to. */
  gameId: string;
  awards: PlayerAward[];
}

interface ProfileState {
  profiles: Profile[];
  activeId: string | null;
  loaded: boolean;
  /** XP from the game that just ended (Game Over modal). */
  lastMatch: LastMatch | null;
  /** Replace everything with a doc loaded from disk. */
  hydrate(doc: ProfilesDoc): void;
  /** Returns the new profile's id, or null when the limit is reached. */
  create(name: string, avatarId: string): string | null;
  update(id: string, patch: Partial<Pick<Profile, 'name' | 'avatarId'>>): void;
  remove(id: string): void;
  setActive(id: string): void;
  /**
   * Equip an unlocked item on the active profile; `on: false` takes off a title or effect.
   * Returns false when there is no active profile or the item is locked.
   */
  equip(kind: RewardKind, id: string, on?: boolean): boolean;
  /** Award XP and record the live game once it has ended. Idempotent per game. */
  settleFinishedGame(now?: Date): void;
  /** Award XP and record an online game from the server's result. Idempotent per game. */
  settleOnlineGame(game: FinishedOnlineGame, now?: Date): void;
}

/** Online games already settled in this session (a result can arrive again after a rejoin). */
const settledOnline = new Set<string>();

export const useProfiles = create<ProfileState>()((set, get) => {
  const commit = (patch: Partial<Pick<ProfileState, 'profiles' | 'activeId'>>) => {
    set(patch);
    const { profiles, activeId } = get();
    persistence?.saveProfiles({ profiles, activeId });
  };

  return {
    profiles: [],
    activeId: null,
    loaded: false,
    lastMatch: null,

    hydrate(doc) {
      // Level is derived from total XP, so a hand-edited file can't desync them.
      const profiles = doc.profiles.map((p) => ({ ...p, level: levelForXp(p.xp) }));
      const activeId = profiles.some((p) => p.id === doc.activeId)
        ? doc.activeId
        : (profiles[0]?.id ?? null);
      set({ profiles, activeId, loaded: true });
    },

    create(name, avatarId) {
      const { profiles } = get();
      if (profiles.length >= MAX_PROFILES) return null;
      const p = newProfile(name, avatarId);
      commit({ profiles: [...profiles, p], activeId: p.id });
      return p.id;
    },

    update(id, patch) {
      commit({ profiles: get().profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
    },

    remove(id) {
      const profiles = get().profiles.filter((p) => p.id !== id);
      const activeId = get().activeId === id ? (profiles[0]?.id ?? null) : get().activeId;
      commit({ profiles, activeId });
    },

    setActive(id) {
      if (get().profiles.some((p) => p.id === id)) commit({ activeId: id });
    },

    equip(kind, id, on = true) {
      const p = selectActiveProfile(get());
      if (!p || (on && !isUnlocked(kind, id, p.level))) return false;
      const e = { ...p.equipped, effects: [...p.equipped.effects] };
      let avatarId = p.avatarId;
      switch (kind) {
        case 'avatar':
          if (!on) return false;
          avatarId = id;
          break;
        case 'title':
          if (on) e.title = id;
          else if (e.title === id) delete e.title;
          break;
        case 'effect':
          e.effects = on ? [...new Set([...e.effects, id])] : e.effects.filter((x) => x !== id);
          break;
        default:
          if (!on) return false;
          e[kind] = id;
      }
      commit({
        profiles: get().profiles.map((x) => (x.id === p.id ? { ...x, avatarId, equipped: e } : x)),
      });
      return true;
    },

    settleFinishedGame(now = new Date()) {
      const game = useGameStore.getState();
      if (game.status !== 'over' || !game.result || !game.settings) return;
      if (game.settings.mode === 'online') return;
      if (get().lastMatch?.gameId === game.startedAt) return;
      const settlement = settleMatch(
        get().profiles,
        {
          settings: game.settings,
          result: game.result,
          history: game.history,
          pgn: currentPgn(),
          assists: game.assists,
        },
        now,
      );
      set({ lastMatch: { gameId: game.startedAt, awards: settlement.awards } });
      if (settlement.awards.length > 0) commit({ profiles: settlement.profiles });
      persistence?.addRecord(settlement.record);
    },

    settleOnlineGame(game, now = new Date()) {
      if (settledOnline.has(game.gameId)) return;
      settledOnline.add(game.gameId);
      const settlement = settleOnlineMatch(get().profiles, game, now);
      set({ lastMatch: { gameId: game.gameId, awards: settlement?.awards ?? [] } });
      if (!settlement) return;
      if (settlement.awards.length > 0) commit({ profiles: settlement.profiles });
      persistence?.addRecord(settlement.record);
    },
  };
});

export const selectActiveProfile = (s: ProfileState): Profile | null =>
  s.profiles.find((p) => p.id === s.activeId) ?? null;

export const useActiveProfile = () => useProfiles(selectActiveProfile);

/** The active profile's board, pieces, frame… resolved against its level. */
export function useCosmetics(): Cosmetics {
  const profile = useActiveProfile();
  return useMemo(() => cosmeticsFor(profile), [profile]);
}

export const useProfile = (id: string | undefined) =>
  useProfiles((s) => (id ? (s.profiles.find((p) => p.id === id) ?? null) : null));

/** Settle every game the moment it ends (whatever ended it: a move, the clock, resignation…). */
export function wireProgression(): () => void {
  return useGameStore.subscribe((s, prev) => {
    if (s.status === 'over' && prev.status !== 'over') useProfiles.getState().settleFinishedGame();
  });
}
