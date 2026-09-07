/** Seconds → m:ss, or h:mm:ss past an hour. Negatives and NaN read as "0:00". */
export function mmss(secs: number | undefined | null): string {
  if (secs == null || !Number.isFinite(secs) || secs < 0) return '0:00';
  const total = Math.floor(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "found 4s ago" / "found 3m ago" — for the household status line. */
export function agoLabel(msEpoch: number, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - msEpoch) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const clampVol = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** Word-mark for a service id — we spell it out, we never draw a logo. */
export function serviceLabel(id: string | undefined): string {
  switch (id) {
    case 'apple':
      return 'Apple Music';
    case 'spotify':
      return 'Spotify';
    case 'tunein':
      return 'TuneIn';
    case 'sonos-radio':
      return 'Sonos Radio';
    default:
      return id ? id.replace(/[-_]/g, ' ') : '';
  }
}
