/**
 * The shape the search overlay puts on a raw SearchResults: which kinds there
 * are, which service a view is narrowed to, the cross-service near-duplicates
 * folded into one song row, and the one result worth putting on top.
 *
 * Pure functions, no React — the overlay recomputes these on every render.
 */
import type { MediaItem, SearchResults, ServiceId } from '../api/types';

export type Kind = 'all' | 'tracks' | 'albums' | 'artists' | 'playlists' | 'stations';
export type ListKind = Exclude<Kind, 'all'>;
export type SvcFilter = 'both' | 'apple' | 'spotify';

export const KINDS: { key: Kind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'tracks', label: 'Songs' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'stations', label: 'Stations' },
];

export const LIST_KINDS: ListKind[] = ['tracks', 'albums', 'artists', 'playlists', 'stations'];

/** The two services the filter chooses between. Anything else (TuneIn) is left alone by it. */
const FILTERABLE: ServiceId[] = ['apple', 'spotify'];

export function passes(item: MediaItem, svc: SvcFilter): boolean {
  if (svc === 'both' || !FILTERABLE.includes(item.service)) return true;
  return item.service === svc;
}

/** Which of Apple Music / Spotify contributed anything at all. */
export function servicesPresent(r: SearchResults): Set<ServiceId> {
  const seen = new Set<ServiceId>();
  for (const k of LIST_KINDS) for (const m of r[k]) if (FILTERABLE.includes(m.service)) seen.add(m.service);
  return seen;
}

// ── Normalising ─────────────────────────────────────────────────────────────

/** Lowercase, straight quotes, punctuation to spaces, whitespace collapsed. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A song title without its remaster tag: "Doctor My Eyes - Remastered",
 * "Doctor My Eyes (2022 Remaster)" and "Doctor My Eyes - 2007 Remastered
 * Version" all come back as "doctor my eyes". Live takes, edits and mixes are
 * different recordings and keep their suffix.
 */
export function normTitle(title: string): string {
  const stripped = title
    .replace(/\s*[([][^)\]]*remaster[^)\]]*[)\]]/gi, '')
    .replace(/\s+[-–—]\s+[^-–—]*remaster[^-–—]*$/i, '');
  return norm(stripped || title);
}

/** The artist half of a track subtitle ("Artist · Album"). */
export function trackArtist(item: MediaItem): string {
  return (item.subtitle ?? '').split(' · ')[0] ?? '';
}

// ── Songs: one row per recording ────────────────────────────────────────────

export interface SongRow {
  /** Stable React key — the first item's service and id. */
  key: string;
  /** The same song from each service, in the order the results gave them; items[0] is the default. */
  items: MediaItem[];
}

/**
 * Fold a Spotify and an Apple Music result for the same song (same
 * normalised title, same artist) into one row. A row holds at most one item
 * per service, so two different Spotify cuts of a song stay two rows. The row
 * sits where its first result was.
 */
export function songRows(tracks: MediaItem[], collapse: boolean): SongRow[] {
  const rows: SongRow[] = [];
  const byKey = new Map<string, SongRow[]>();
  for (const t of tracks) {
    const k = `${normTitle(t.title)}\u0000${norm(trackArtist(t))}`;
    const open = collapse ? (byKey.get(k) ?? []) : [];
    const home = open.find((r) => !r.items.some((i) => i.service === t.service));
    if (home) {
      home.items.push(t);
      continue;
    }
    const row: SongRow = { key: `${t.service}-${t.id}`, items: [t] };
    rows.push(row);
    byKey.set(k, [...open, row]);
  }
  return rows;
}

// ── Top result ──────────────────────────────────────────────────────────────

/** Tie-break order when two kinds score the same. */
const KIND_RANK: Record<string, number> = { artist: 0, album: 1, track: 2, playlist: 3, station: 4 };

/**
 * How well one item answers the query, 0 when it doesn't stand out at all.
 * Title matches beat artist-name matches; exact beats prefix beats whole-word.
 * An artist whose name is the query wins outright; an album *by* that artist
 * comes next, so "jackson browne" lands on the man or his record, not a song.
 */
export function relevance(item: MediaItem, q: string): number {
  if (!q) return 0;
  const title = normTitle(item.title);
  const exact: Record<string, number> = { artist: 100, album: 90, track: 84, playlist: 72, station: 72 };
  const prefix: Record<string, number> = { artist: 70, album: 64, track: 60, playlist: 52, station: 52 };
  // Of two same-named artists (one per service), the one with a picture reads better on top.
  if (title === q) return (exact[item.kind] ?? 0) + (item.kind === 'artist' && item.art ? 1 : 0);

  const by = item.kind === 'track' ? trackArtist(item) : item.kind === 'album' ? (item.subtitle ?? '') : '';
  const byNorm = by ? norm(by) : '';
  if (byNorm === q) return item.kind === 'album' ? 80 : 56;

  if (title.startsWith(q)) return prefix[item.kind] ?? 0;
  if (` ${title} `.includes(` ${q} `)) return 30;
  if (byNorm && byNorm.startsWith(q)) return 24;
  return 0;
}

/** The single best item across every kind, or the services' own first pick when nothing stands out. */
export function topResult(lists: Record<ListKind, MediaItem[]>, query: string): MediaItem | undefined {
  const q = norm(query);
  let best: { item: MediaItem; score: number; rank: number; index: number } | undefined;
  for (const k of LIST_KINDS) {
    lists[k].forEach((item, index) => {
      const score = relevance(item, q);
      if (score === 0) return;
      const rank = KIND_RANK[item.kind] ?? 9;
      if (
        !best ||
        score > best.score ||
        (score === best.score && (index < best.index || (index === best.index && rank < best.rank)))
      ) {
        best = { item, score, rank, index };
      }
    });
  }
  if (best) return best.item;
  for (const k of LIST_KINDS) if (lists[k][0]) return lists[k][0];
  return undefined;
}
