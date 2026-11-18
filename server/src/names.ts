/** Cleaning of the player details other people see. */

export const NAME_MAX_LENGTH = 20;
export const FALLBACK_NAME = 'Player';

/**
 * Words that make a name unusable (checked after folding case, accents, look-alike digits
 * and separators). Deliberately short: it catches the obvious cases; reports would need a
 * moderation process, which is out of scope for v1.
 */
const BLOCKED = [
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'whore',
  'slut',
  'rape',
  'nazi',
  'hitler',
  'kike',
  'spic',
  'chink',
  'dick',
  'cock',
  'pussy',
  'penis',
  'vagina',
  'porn',
  'admin',
  'moderator',
];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

function fold(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[01345@$7]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '');
}

export function isBlockedName(name: string): boolean {
  const folded = fold(name);
  return BLOCKED.some((word) => folded.includes(word));
}

/** Trim, strip control/invisible characters, collapse spaces, cap the length, filter. */
export function cleanName(raw: string): string {
  const name = [
    ...raw
      .normalize('NFC')
      .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, NAME_MAX_LENGTH)
    .join('')
    .trim();
  if (!name || isBlockedName(name)) return FALLBACK_NAME;
  return name;
}

export function cleanLevel(level: number): number {
  return Math.min(50, Math.max(1, Math.round(level)));
}
