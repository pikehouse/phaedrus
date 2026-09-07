/** Deterministic 32-bit string hash (FNV-1a). Same title always gets the same sleeve. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pick a stable element of `list` for a given key. */
export function pickBy<T>(key: string, list: readonly T[]): T {
  return list[hashString(key) % list.length];
}
