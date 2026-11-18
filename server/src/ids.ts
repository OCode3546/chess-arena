import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@shared/protocol';

/** URL-safe random id with `bytes` bytes of entropy. */
export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

/** A 6-character invite code that isn't in use yet. */
export function newRoomCode(taken: (code: string) => boolean): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    }
    if (!taken(code)) return code;
  }
}

/**
 * The id other players see: stable for a guest (so the app can limit XP farming against
 * the same opponent) but it can't be turned back into the secret guest id.
 */
export function publicId(guestId: string, secret: string): string {
  return createHmac('sha256', secret).update(guestId).digest('base64url').slice(0, 16);
}

export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
