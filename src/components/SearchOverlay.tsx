import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { api, isTauri } from '../api';
import { useSonos } from '../store/useSonos';
import { mmss, serviceLabel } from '../lib/format';
import {
  KINDS,
  LIST_KINDS,
  passes,
  servicesPresent,
  songRows,
  topResult,
  type Kind,
  type ListKind,
  type SongRow,
  type SvcFilter,
} from '../lib/searchModel';
import { Back, Close, Plus, Play, QueueNext } from './Icons';
import type { LinkSession, MediaItem, MusicService, SearchResults, ServiceId } from '../api/types';
import '../styles/search.css';

const EMPTY: SearchResults = {
  query: '',
  tracks: [],
  albums: [],
  artists: [],
  playlists: [],
  stations: [],
  errors: [],
};

const SVC_OPTIONS: { key: SvcFilter; label: string }[] = [
  { key: 'both', label: 'Both' },
  { key: 'apple', label: 'Apple Music' },
  { key: 'spotify', label: 'Spotify' },
];

/** How much of each kind the All overview shows before "See all". */
const OVERVIEW: Record<ListKind, number> = { tracks: 5, albums: 6, artists: 6, playlists: 6, stations: 4 };

const KIND_NOUN: Record<string, string> = {
  track: 'Song',
  album: 'Album',
  artist: 'Artist',
  playlist: 'Playlist',
  station: 'Station',
};

/** Secondary queue actions. The primary one is always the user's tap setting. */
type QueueFn = (item: MediaItem, action: 'next' | 'later') => void;
type TapFn = (item: MediaItem) => void;

export default function SearchOverlay() {
  const open = useSonos((s) => s.searchOpen);
  const setOpen = useSonos((s) => s.setSearchOpen);
  const group = useSonos((s) => s.group);
  const topology = useSonos((s) => s.topology);
  const playItem = useSonos((s) => s.playItem);
  const playItemTap = useSonos((s) => s.playItemTap);

  const anyIp = group?.coordinatorIp ?? topology?.groups[0]?.coordinatorIp ?? '';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [searching, setSearching] = useState(false);
  const [services, setServices] = useState<MusicService[]>([]);
  const [drill, setDrill] = useState<{ artist: MediaItem; albums: MediaItem[] } | null>(null);
  const [drilling, setDrilling] = useState(false);
  const [kind, setKind] = useState<Kind>('all');
  const [svc, setSvc] = useState<SvcFilter>('both');
  /** Which service a collapsed song row plays from, by row key. */
  const [picks, setPicks] = useState<Record<string, ServiceId>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const runId = useRef(0);
  const artistRun = useRef(0);

  const onTap = useCallback<TapFn>((item) => void playItemTap(item), [playItemTap]);
  const onQueue = useCallback<QueueFn>((item, action) => void playItem(item, action), [playItem]);

  /** Leave the artist page; albums still on their way for it are dropped. */
  const closeDrill = useCallback(() => {
    artistRun.current++;
    setDrill(null);
    setDrilling(false);
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      if (!anyIp || q.trim().length < 2) {
        runId.current++; // anything still out is for a query that no longer stands
        setResults(EMPTY);
        setSearching(false);
        return;
      }
      const id = ++runId.current;
      setSearching(true);
      try {
        const r = await api.search(anyIp, q.trim());
        if (id === runId.current) setResults(r); // keep the old list until the new one lands
      } catch {
        if (id === runId.current) setResults({ ...EMPTY, query: q, errors: [] });
      } finally {
        if (id === runId.current) setSearching(false);
      }
    },
    [anyIp],
  );

  // Focus, reset drill-down and kind, and re-read service state each time it opens.
  useEffect(() => {
    if (!open) return;
    closeDrill();
    setKind('all');
    inputRef.current?.focus();
    inputRef.current?.select();
    if (anyIp) api.getServices(anyIp).then(setServices).catch(() => setServices([]));
  }, [open, anyIp, closeDrill]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void runSearch(query), 350);
    return () => clearTimeout(t);
  }, [query, open, runSearch]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (drill) closeDrill();
      else setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, drill, setOpen, closeDrill]);

  // A new view starts at its top, and its chip is in sight on a narrow row.
  useEffect(() => {
    resultsRef.current?.scrollTo({ top: 0 });
    const i = KINDS.findIndex((k) => k.key === kind);
    chipRefs.current[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [kind, drill?.artist]);

  const openArtist = async (artist: MediaItem) => {
    const id = ++artistRun.current;
    setDrilling(true);
    setDrill({ artist, albums: [] });
    try {
      const albums = await api.artistAlbums(anyIp, artist);
      if (id === artistRun.current) setDrill({ artist, albums });
    } catch {
      if (id === artistRun.current) setDrill({ artist, albums: [] });
    } finally {
      if (id === artistRun.current) setDrilling(false);
    }
  };

  // ── What the chips and views show ────────────────────────────────────────

  const present = useMemo(() => servicesPresent(results), [results]);
  const showSvc = present.size > 1;
  // A filter the new results can't honour (only one service answered) stands down.
  const eff: SvcFilter = showSvc ? svc : 'both';

  const lists = useMemo(() => {
    const out = {} as Record<ListKind, MediaItem[]>;
    for (const k of LIST_KINDS) out[k] = results[k].filter((m) => passes(m, eff));
    return out;
  }, [results, eff]);

  const songs = useMemo(() => songRows(lists.tracks, eff === 'both'), [lists.tracks, eff]);
  const top = useMemo(() => topResult(lists, results.query || query), [lists, results.query, query]);

  const counts: Record<Kind, number> = {
    all: 0,
    tracks: songs.length,
    albums: lists.albums.length,
    artists: lists.artists.length,
    playlists: lists.playlists.length,
    stations: lists.stations.length,
  };
  counts.all = LIST_KINDS.reduce((n, k) => n + counts[k], 0);

  if (!open) return null;

  const spotify = services.find((s) => s.id === 'spotify');
  const hits = LIST_KINDS.reduce((n, k) => n + results[k].length, 0);
  const short = query.trim().length < 2;

  const choose = (next: Kind) => {
    if (drill) closeDrill();
    setKind(next);
  };

  /** Step the chip selection; `focus` moves keyboard focus with it (chip row), or leaves it in the input. */
  const step = (dir: 1 | -1, focus: boolean): boolean => {
    const i = KINDS.findIndex((k) => k.key === kind);
    const j = i + dir;
    if (j < 0 || j >= KINDS.length) return false;
    choose(KINDS[j].key);
    if (focus) chipRefs.current[j]?.focus();
    return true;
  };

  const onInputKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!e.altKey || short) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      step(e.key === 'ArrowRight' ? 1 : -1, false);
    }
  };

  const onChipsKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    let dir: 1 | -1 | 0 = 0;
    if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) dir = 1;
    else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) dir = -1;
    if (!dir) return;
    // Tab past either end leaves the row the ordinary way.
    if (step(dir, true)) e.preventDefault();
  };

  const pick = (row: SongRow) => row.items.find((i) => i.service === picks[row.key]) ?? row.items[0];
  const setPick = (row: SongRow, s: ServiceId) => setPicks((p) => ({ ...p, [row.key]: s }));
  const songList = (rows: SongRow[]) => (
    <ul className="search-list">
      {rows.map((row) => (
        <SongRowView key={row.key} row={row} chosen={pick(row)} onPick={(s) => setPick(row, s)} onTap={onTap} onQueue={onQueue} />
      ))}
    </ul>
  );
  const rowList = (items: MediaItem[]) => (
    <ul className="search-list">
      {items.map((item) => (
        <Row key={`${item.service}-${item.id}`} item={item} onTap={onTap} onQueue={onQueue} />
      ))}
    </ul>
  );
  const coverGrid = (items: MediaItem[], row = false) => (
    <ul className={`sgrid${row ? ' is-row' : ''}`}>
      {items.map((item) => (
        <Tile key={`${item.service}-${item.id}`} item={item} onTap={onTap} onQueue={onQueue} />
      ))}
    </ul>
  );
  const artistGrid = (items: MediaItem[], row = false) => (
    <ul className={`sgrid is-artists${row ? ' is-row' : ''}`}>
      {items.map((item) => (
        <ArtistTile key={`${item.service}-${item.id}`} item={item} onOpen={() => void openArtist(item)} />
      ))}
    </ul>
  );

  const render: Record<ListKind, (row: boolean) => ReactNode> = {
    tracks: (overview) => songList(overview ? songs.slice(0, OVERVIEW.tracks) : songs),
    albums: (overview) => coverGrid(overview ? lists.albums.slice(0, OVERVIEW.albums) : lists.albums, overview),
    artists: (overview) => artistGrid(overview ? lists.artists.slice(0, OVERVIEW.artists) : lists.artists, overview),
    playlists: (overview) =>
      coverGrid(overview ? lists.playlists.slice(0, OVERVIEW.playlists) : lists.playlists, overview),
    stations: (overview) => rowList(overview ? lists.stations.slice(0, OVERVIEW.stations) : lists.stations),
  };

  const labelOf = (k: Kind) => KINDS.find((x) => x.key === k)?.label ?? '';
  const selectedIdx = KINDS.findIndex((k) => k.key === kind);

  let view: ReactNode = null;
  if (drill) {
    const albums = drill.albums.filter((m) => passes(m, eff));
    view = (
      <>
        <button type="button" className="search-crumb" onClick={closeDrill}>
          <Back size={15} />
          <span className="label">{kind === 'artists' ? 'Artists' : 'All results'}</span>
        </button>
        <h3 className="search-drill-title">{drill.artist.title}</h3>
        {drilling && <p className="label search-working">loading albums…</p>}
        {!drilling && albums.length === 0 && <p className="label search-working">no albums for this artist</p>}
        {coverGrid(albums)}
      </>
    );
  } else if (!short && kind === 'all') {
    view = (
      <>
        {top && (
          <TopCard
            item={top}
            onTap={onTap}
            onQueue={onQueue}
            onOpenArtist={() => void openArtist(top)}
          />
        )}
        {LIST_KINDS.map((k) =>
          counts[k] === 0 ? null : (
            <section key={k} className={`search-section is-${k}`}>
              <header className="search-section-top">
                <h3 className="label search-section-head">{labelOf(k)}</h3>
                <button type="button" className="search-more" onClick={() => choose(k)}>
                  See all <span aria-hidden="true">›</span>
                  <span className="search-more-n">{counts[k]}</span>
                </button>
              </header>
              {render[k](true)}
            </section>
          ),
        )}
      </>
    );
  } else if (!short) {
    const k = kind as ListKind;
    view =
      counts[k] === 0 ? (
        !searching &&
        hits > 0 && (
          <p className="search-empty">
            No {labelOf(k).toLowerCase()}
            {eff !== 'both' ? ` on ${serviceLabel(eff)}` : ''} for “{query.trim()}”.
          </p>
        )
      ) : (
        <section className={`search-section is-${k} is-full`}>{render[k](false)}</section>
      );
  }

  return (
    <div className="search-scrim" role="dialog" aria-modal="true" aria-label="Search music">
      <button
        type="button"
        className="search-dismiss"
        aria-label="Close search"
        onClick={() => setOpen(false)}
      />

      <div className="search-panel">
        <div className="search-bar">
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setKind('all');
            }}
            onKeyDown={onInputKey}
            placeholder="What shall we play?"
            aria-label="Search Apple Music, Spotify and TuneIn"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className="search-close" aria-label="Close search" onClick={() => setOpen(false)}>
            <Close size={20} />
          </button>
        </div>

        {!short && (
          <div className="search-kinds">
            <div className="search-chips" role="tablist" aria-label="Kind of result" onKeyDown={onChipsKey}>
              {KINDS.map((k, i) => {
                const on = k.key === kind;
                return (
                  <button
                    key={k.key}
                    ref={(el) => {
                      chipRefs.current[i] = el;
                    }}
                    type="button"
                    role="tab"
                    id={`search-tab-${k.key}`}
                    aria-selected={on}
                    aria-controls="search-view"
                    tabIndex={on ? 0 : -1}
                    className={`search-chip${on ? ' is-on' : ''}${counts[k.key] === 0 ? ' is-empty' : ''}`}
                    onClick={() => choose(k.key)}
                  >
                    <span className="search-chip-label">{k.label}</span>
                    <span className="search-chip-count">{counts[k.key]}</span>
                  </button>
                );
              })}
            </div>
            {showSvc && (
              <div className="search-svc" role="radiogroup" aria-label="Service">
                {SVC_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    role="radio"
                    aria-checked={svc === o.key}
                    className={`search-svc-opt${svc === o.key ? ' is-on' : ''}`}
                    onClick={() => setSvc(o.key)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="search-status">
          {searching && <span className="label search-working">searching…</span>}
          {!searching && !short && hits === 0 && (
            <span className="label search-working">nothing found</span>
          )}
          {results.errors.map((e) => (
            <span key={e.service} className="search-error">
              {serviceLabel(e.service)} — {e.message}
            </span>
          ))}
        </div>

        {spotify?.needsLink && <SpotifyLink anyIp={anyIp} onLinked={() => {
          api.getServices(anyIp).then(setServices).catch(() => {});
          void runSearch(query);
        }} />}

        <div
          ref={resultsRef}
          className="search-results scroll"
          id="search-view"
          role={short ? undefined : 'tabpanel'}
          aria-labelledby={short ? undefined : `search-tab-${KINDS[selectedIdx].key}`}
        >
          {view}

          {short && !drill && (
            <p className="search-prompt">
              Apple Music, Spotify and TuneIn — all at once.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Rows ────────────────────────────────────────────────────────────────────

function subLine(item: MediaItem): string {
  return [
    item.subtitle,
    item.year ? String(item.year) : '',
    item.durationSecs ? mmss(item.durationSecs) : '',
    item.trackCount ? `${item.trackCount} tracks` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function Tools({ item, onTap, onQueue, className = 'sresult-tools' }: { item: MediaItem; onTap: TapFn; onQueue: QueueFn; className?: string }) {
  return (
    <div className={className}>
      <button type="button" className="sresult-tool" aria-label={`Play ${item.title}`} onClick={() => onTap(item)}>
        <Play size={13} />
      </button>
      <button type="button" className="sresult-tool" aria-label={`Play ${item.title} next`} onClick={() => onQueue(item, 'next')}>
        <QueueNext size={14} />
      </button>
      <button type="button" className="sresult-tool" aria-label={`Add ${item.title} to the queue`} onClick={() => onQueue(item, 'later')}>
        <Plus size={14} />
      </button>
    </div>
  );
}

function Row({ item, onTap, onQueue }: { item: MediaItem; onTap: TapFn; onQueue: QueueFn }) {
  return (
    <li className="sresult">
      <button type="button" className="sresult-main" onClick={() => onTap(item)} aria-label={`Play ${item.title}`}>
        <span className="sresult-art">
          <RowArt src={item.art} />
        </span>
        <span className="sresult-text">
          <span className="sresult-title">{item.title}</span>
          <span className="sresult-sub">{subLine(item)}</span>
        </span>
      </button>
      <span className="label sresult-badge">{serviceLabel(item.service)}</span>
      <Tools item={item} onTap={onTap} onQueue={onQueue} />
    </li>
  );
}

const SHORT_SVC: Record<string, string> = { apple: 'Apple', spotify: 'Spotify' };
/** For a phone row, where every pixel is the title's. */
const TINY_SVC: Record<string, string> = { apple: 'AM', spotify: 'SP' };

/** One song, possibly from two services; the badge becomes the switch between them. */
function SongRowView({
  row,
  chosen,
  onPick,
  onTap,
  onQueue,
}: {
  row: SongRow;
  chosen: MediaItem;
  onPick: (s: ServiceId) => void;
  onTap: TapFn;
  onQueue: QueueFn;
}) {
  if (row.items.length === 1) return <Row item={chosen} onTap={onTap} onQueue={onQueue} />;
  return (
    <li className="sresult has-pick">
      <button type="button" className="sresult-main" onClick={() => onTap(chosen)} aria-label={`Play ${chosen.title}`}>
        <span className="sresult-art">
          <RowArt src={chosen.art} />
        </span>
        <span className="sresult-text">
          <span className="sresult-title">{chosen.title}</span>
          <span className="sresult-sub">{subLine(chosen)}</span>
        </span>
      </button>
      <span className="sresult-pick" role="radiogroup" aria-label={`Play ${chosen.title} from`}>
        {row.items.map((i) => (
          <button
            key={i.service}
            type="button"
            role="radio"
            aria-checked={i === chosen}
            aria-label={serviceLabel(i.service)}
            title={serviceLabel(i.service)}
            className={`sresult-pick-opt${i === chosen ? ' is-on' : ''}`}
            onClick={() => onPick(i.service)}
          >
            <span className="sresult-pick-long">{SHORT_SVC[i.service] ?? serviceLabel(i.service)}</span>
            <span className="sresult-pick-short" aria-hidden="true">{TINY_SVC[i.service] ?? serviceLabel(i.service).slice(0, 2)}</span>
          </button>
        ))}
      </span>
      <Tools item={chosen} onTap={onTap} onQueue={onQueue} />
    </li>
  );
}

// ── Tiles ───────────────────────────────────────────────────────────────────

function Tile({ item, onTap, onQueue }: { item: MediaItem; onTap: TapFn; onQueue: QueueFn }) {
  const [open, setOpen] = useState(false);
  const meta = [item.year ? String(item.year) : '', item.trackCount ? `${item.trackCount} tracks` : '']
    .filter(Boolean)
    .join(' · ');
  const act: TapFn = (i) => {
    setOpen(false);
    onTap(i);
  };
  const queue: QueueFn = (i, a) => {
    setOpen(false);
    onQueue(i, a);
  };
  return (
    <li className={`stile${open ? ' is-open' : ''}`}>
      <button type="button" className="stile-face" onClick={() => act(item)} aria-label={`Play ${item.title}`}>
        <span className="stile-cover">
          <RowArt src={item.art} />
        </span>
        <span className="stile-cap">
          <span className="stile-title">{item.title}</span>
          {item.subtitle && <span className="stile-sub">{item.subtitle}</span>}
          {meta && <span className="stile-meta">{meta}</span>}
        </span>
      </button>
      <Tools item={item} onTap={act} onQueue={queue} className="stile-tools" />
      <button
        type="button"
        className="stile-more"
        aria-expanded={open}
        aria-label={open ? 'Hide actions' : `Actions for ${item.title}`}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <Close size={13} /> : <span aria-hidden="true">…</span>}
      </button>
    </li>
  );
}

function ArtistTile({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const initials = item.title
    .replace(/^the\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('');
  return (
    <li className="stile is-artist">
      <button type="button" className="stile-face" onClick={onOpen} aria-label={`Albums by ${item.title}`}>
        <span className="stile-cover is-round">
          <RowArt src={item.art} fallback={<span className="stile-mono">{initials}</span>} />
        </span>
        <span className="stile-cap">
          <span className="stile-title">{item.title}</span>
          {item.subtitle && <span className="stile-sub">{item.subtitle}</span>}
        </span>
      </button>
    </li>
  );
}

// ── Top result ──────────────────────────────────────────────────────────────

function TopCard({
  item,
  onTap,
  onQueue,
  onOpenArtist,
}: {
  item: MediaItem;
  onTap: TapFn;
  onQueue: QueueFn;
  onOpenArtist: () => void;
}) {
  const isArtist = item.kind === 'artist';
  const primary = () => (isArtist ? onOpenArtist() : onTap(item));
  return (
    <section className="search-top" aria-label="Top result">
      <h3 className="label search-section-head">Top result</h3>
      <div className={`stop is-${item.kind}`}>
        <button
          type="button"
          className={`stop-art${isArtist ? ' is-round' : ''}`}
          onClick={primary}
          aria-label={isArtist ? `Albums by ${item.title}` : `Play ${item.title}`}
          tabIndex={-1}
        >
          <RowArt src={item.art} fallback={isArtist ? <span className="stile-mono">{item.title.slice(0, 1)}</span> : undefined} />
        </button>
        <div className="stop-body">
          <span className="label stop-kind">
            {KIND_NOUN[item.kind] ?? item.kind}
            <span className="stop-svc"> · {serviceLabel(item.service)}</span>
          </span>
          <span className="stop-title">{item.title}</span>
          {!isArtist && <span className="stop-sub">{subLine(item)}</span>}
          {isArtist && item.subtitle && <span className="stop-sub">{item.subtitle}</span>}
          <div className="stop-actions">
            {/* The primary button borrows the link card's button, which every skin already dresses. */}
            <button
              type="button"
              className="linkcard-btn stop-play"
              onClick={primary}
              aria-label={isArtist ? `Albums by ${item.title}` : `Play ${item.title}`}
            >
              {isArtist ? 'See albums' : (
                <>
                  <Play size={11} /> Play
                </>
              )}
            </button>
            {!isArtist && (
              <>
                <button type="button" className="sresult-tool" aria-label={`Play ${item.title} next`} onClick={() => onQueue(item, 'next')}>
                  <QueueNext size={14} />
                </button>
                <button type="button" className="sresult-tool" aria-label={`Add ${item.title} to the queue`} onClick={() => onQueue(item, 'later')}>
                  <Plus size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** A cover the art cache refuses (403, gone) falls back to the blank stock. */
function RowArt({ src, fallback }: { src?: string; fallback?: ReactNode }) {
  const [broken, setBroken] = useState<string | undefined>();
  if (!src || broken === src) return <span className="sresult-art-blank">{fallback}</span>;
  return <img src={src} alt="" loading="lazy" draggable={false} onError={() => setBroken(src)} />;
}

/** Rust keeps answering 'pending' through timeouts; give up on our own after this. */
const LINK_TIMEOUT_MS = 5 * 60 * 1000;

/** One-time Spotify authorization: open the page, then wait for the household. */
function SpotifyLink({ anyIp, onLinked }: { anyIp: string; onLinked: () => void }) {
  const say = useSonos((s) => s.say);
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'failed' | 'timedOut'>('idle');
  const session = useRef<LinkSession | null>(null);
  const startedAt = useRef(0);
  // The parent hands us a new callback every render; the poll reads the latest
  // without being torn down and rebuilt for it.
  const linked = useRef(onLinked);
  useEffect(() => {
    linked.current = onLinked;
  }, [onLinked]);

  useEffect(() => {
    if (phase !== 'waiting') return;
    let alive = true;
    let checking = false;
    const timer = setInterval(async () => {
      const s = session.current;
      if (!s || checking) return;
      checking = true;
      try {
        const status = await api.linkPoll(anyIp, s);
        if (status === 'linked') {
          clearInterval(timer);
          // Rust has stored the token by now: finish the job even if this
          // effect was torn down while the check was out — but only once.
          if (session.current !== s) return;
          session.current = null;
          setPhase('idle');
          say('Spotify connected');
          linked.current();
        } else if (status === 'failed' && alive) {
          clearInterval(timer);
          setPhase('failed');
        } else if (status === 'pending' && alive && Date.now() - startedAt.current >= LINK_TIMEOUT_MS) {
          clearInterval(timer);
          session.current = null;
          setPhase('timedOut');
        }
      } catch {
        if (alive) {
          clearInterval(timer);
          setPhase('failed');
        }
      } finally {
        checking = false;
      }
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [phase, anyIp, say]);

  const begin = async () => {
    try {
      const s = await api.linkBegin(anyIp, 'spotify');
      session.current = s;
      startedAt.current = Date.now();
      setPhase('waiting');
      if (isTauri()) {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(s.url);
      } else {
        window.open(s.url, '_blank', 'noopener');
      }
    } catch {
      setPhase('failed');
    }
  };

  return (
    <div className="linkcard">
      <div className="linkcard-text">
        <p className="linkcard-title">Spotify search needs a one-time connection</p>
        <p className="linkcard-sub">
          {phase === 'waiting'
            ? 'Waiting for you to sign in…'
            : phase === 'failed'
              ? 'That did not go through.'
              : phase === 'timedOut'
                ? 'That took too long — try again.'
                : 'Apple Music and TuneIn are already listening.'}
        </p>
      </div>
      {phase === 'waiting' ? (
        <span className="linkcard-wait" aria-live="polite">
          <span className="linkcard-dot" aria-hidden="true" />
        </span>
      ) : (
        <button type="button" className="linkcard-btn" onClick={() => void begin()}>
          {phase === 'failed' || phase === 'timedOut' ? 'Try again' : 'Connect Spotify'}
        </button>
      )}
    </div>
  );
}
