import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_BYTES,
  normalizeRoomCode,
  parseClientMsg,
  parseServerMsg,
  versionAtLeast,
} from '@shared/protocol';
import { cleanName, isBlockedName } from '../src/names';
import { player } from './helpers';

const json = (v: unknown) => JSON.stringify(v);

describe('protocol: client messages', () => {
  it('accepts well-formed messages and drops unknown fields', () => {
    expect(
      parseClientMsg(json({ t: 'game.move', gameId: 'g1', uci: 'e7e8q', seq: 3, x: 1 })),
    ).toEqual({
      t: 'game.move',
      gameId: 'g1',
      uci: 'e7e8q',
      seq: 3,
    });
    expect(
      parseClientMsg(json({ t: 'hello', v: 1, appVersion: '0.9.0', player: player(1) })),
    ).toMatchObject({
      t: 'hello',
    });
    expect(parseClientMsg(json({ t: 'game.drawOffer', gameId: 'abc' }))).toEqual({
      t: 'game.drawOffer',
      gameId: 'abc',
    });
  });

  it('rejects malformed, oversized and unknown messages', () => {
    const bad = [
      'not json',
      '[]',
      json({ t: 'nope' }),
      json({ t: 'game.move', gameId: 'g1', uci: 'e2e9', seq: 0 }),
      json({ t: 'game.move', gameId: 'g 1', uci: 'e2e4', seq: 0 }),
      json({ t: 'game.move', gameId: 'g1', uci: 'e2e4', seq: -1 }),
      json({ t: 'room.create', tc: { baseMs: 60_000, incMs: 0 }, color: 'green' }),
      json({ t: 'queue.join', tc: { baseMs: 1e12, incMs: 0 } }),
      json({ t: 'hello', v: 1, appVersion: 'latest', player: player(1) }),
      json({ t: 'hello', v: 1, appVersion: '0.9.0', player: { ...player(1), level: 99 } }),
      json({ t: 'hello', v: 1, appVersion: '0.9.0', player: { ...player(1), guestId: 'x' } }),
      json({ t: 'ping', ts: 'now', pad: 'x'.repeat(MAX_MESSAGE_BYTES) }),
    ];
    for (const raw of bad) expect(parseClientMsg(raw), raw.slice(0, 80)).toBeNull();
  });
});

describe('protocol: server messages', () => {
  it('validates what the app receives', () => {
    expect(parseServerMsg(json({ t: 'error', code: 'BUSY', message: 'x', gameId: 'g' }))).toEqual({
      t: 'error',
      code: 'BUSY',
      message: 'x',
      gameId: 'g',
    });
    expect(parseServerMsg(json({ t: 'error', code: 'WHAT', message: 'x' }))).toBeNull();
    expect(
      parseServerMsg(
        json({
          t: 'game.over',
          gameId: 'g',
          result: '2-0',
          winner: null,
          reason: 'checkmate',
          pgn: '',
          plies: 1,
        }),
      ),
    ).toBeNull();
    expect(
      parseServerMsg(
        json({
          t: 'game.state',
          gameId: 'g',
          fen: 'x',
          moves: ['e2e4'],
          seq: 1,
          clocks: { w: 1, b: 2 },
          clockRunning: true,
          turn: 'b',
          serverTs: 5,
          drawOfferFrom: null,
        }),
      ),
    ).toMatchObject({ t: 'game.state', seq: 1, drawOfferFrom: null });
  });
});

describe('protocol: helpers', () => {
  it('normalizes typed invite codes', () => {
    expect(normalizeRoomCode(' k7q-m2x ')).toBe('K7QM2X');
  });

  it('compares versions', () => {
    expect(versionAtLeast('0.9.0', '0.9.0')).toBe(true);
    expect(versionAtLeast('0.10.0', '0.9.0')).toBe(true);
    expect(versionAtLeast('1.0.0-beta.1', '0.9.0')).toBe(true);
    expect(versionAtLeast('0.8.9', '0.9.0')).toBe(false);
  });
});

describe('names', () => {
  it('trims, strips invisible characters and caps the length', () => {
    expect(cleanName('  Ann \u202E\u0007 Lee  ')).toBe('Ann Lee');
    expect(cleanName('x'.repeat(40))).toHaveLength(20);
    expect(cleanName('   ')).toBe('Player');
    expect(cleanName('Zoë')).toBe('Zoë');
  });

  it('blocks offensive names, including look-alike spellings', () => {
    expect(isBlockedName('F.U.C.K')).toBe(true);
    expect(isBlockedName('sh1t')).toBe(true);
    expect(cleanName('Admin')).toBe('Player');
    expect(isBlockedName('Magnus')).toBe(false);
    expect(isBlockedName('Grandmaster Sam')).toBe(false);
  });
});
