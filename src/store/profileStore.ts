import { create } from 'zustand';
import type { GameRecord, Profile, ProfilesDoc } from '@shared/types';
import { MAX_PROFILES } from '@shared/validate';
import { levelForXp } from '@/progression/levels';
import { newProfile, settleMatch, type PlayerAward } from '@/progression/match';
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
  /** `startedAt` of the game these awards belong to. */
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
  /** Award XP and record the live game once it has ended. Idempotent per game. */
  settleFinishedGame(now?: Date): void;
}

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

    settleFinishedGame(now = new Date()) {
      const game = useGameStore.getState();
      if (game.status !== 'over' || !game.result || !game.settings) return;
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
  };
});

export const selectActiveProfile = (s: ProfileState): Profile | null =>
  s.profiles.find((p) => p.id === s.activeId) ?? null;

export const useActiveProfile = () => useProfiles(selectActiveProfile);

export const useProfile = (id: string | undefined) =>
  useProfiles((s) => (id ? (s.profiles.find((p) => p.id === id) ?? null) : null));

/** Settle every game the moment it ends (whatever ended it: a move, the clock, resignation…). */
export function wireProgression(): () => void {
  return useGameStore.subscribe((s, prev) => {
    if (s.status === 'over' && prev.status !== 'over') useProfiles.getState().settleFinishedGame();
  });
}
