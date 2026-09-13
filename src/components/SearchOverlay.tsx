import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isTauri } from '../api';
import { useSonos } from '../store/useSonos';
import { mmss, serviceLabel } from '../lib/format';
import { Back, Close, Plus, Play, QueueNext } from './Icons';
import type { LinkSession, MediaItem, MusicService, SearchResults } from '../api/types';
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

const SECTIONS: { key: keyof Omit<SearchResults, 'query' | 'errors'>; label: string }[] = [
  { key: 'tracks', label: 'Tracks' },
  { key: 'albums', label: 'Albums' },
  { key: 'artists', label: 'Artists' },
  { key: 'playlists', label: 'Playlists' },
  { key: 'stations', label: 'Stations' },
];

export default function SearchOverlay() {
  const open = useSonos((s) => s.searchOpen);
  const setOpen = useSonos((s) => s.setSearchOpen);
  const group = useSonos((s) => s.group);
  const topology = useSonos((s) => s.topology);
  const playItem = useSonos((s) => s.playItem);

  const anyIp = group?.coordinatorIp ?? topology?.groups[0]?.coordinatorIp ?? '';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [searching, setSearching] = useState(false);
  const [services, setServices] = useState<MusicService[]>([]);
  const [drill, setDrill] = useState<{ artist: MediaItem; albums: MediaItem[] } | null>(null);
  const [drilling, setDrilling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);
  const artistRun = useRef(0);

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

  // Focus, reset drill-down, and re-read service state each time it opens.
  useEffect(() => {
    if (!open) return;
    closeDrill();
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

  if (!open) return null;

  const spotify = services.find((s) => s.id === 'spotify');
  const hits = SECTIONS.reduce((n, s) => n + results[s.key].length, 0);
  const short = query.trim().length < 2;

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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What shall we play?"
            aria-label="Search Apple Music, Spotify and TuneIn"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className="search-close" aria-label="Close search" onClick={() => setOpen(false)}>
            <Close size={20} />
          </button>
        </div>

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

        <div className="search-results scroll">
          {drill ? (
            <>
              <button type="button" className="search-crumb" onClick={closeDrill}>
                <Back size={15} />
                <span className="label">All results</span>
              </button>
              <h3 className="search-drill-title">{drill.artist.title}</h3>
              {drilling && <p className="label search-working">loading albums…</p>}
              {!drilling && drill.albums.length === 0 && (
                <p className="label search-working">no albums for this artist</p>
              )}
              <ul className="search-list">
                {drill.albums.map((item) => (
                  <Row key={`${item.service}-${item.id}`} item={item} onPlay={playItem} />
                ))}
              </ul>
            </>
          ) : (
            SECTIONS.map(({ key, label }) => {
              const items = results[key];
              if (items.length === 0) return null;
              return (
                <section key={key} className="search-section">
                  <h3 className="label search-section-head">{label}</h3>
                  <ul className="search-list">
                    {items.map((item) => (
                      <Row
                        key={`${item.service}-${item.id}`}
                        item={item}
                        onPlay={playItem}
                        onOpenArtist={item.kind === 'artist' ? () => void openArtist(item) : undefined}
                      />
                    ))}
                  </ul>
                </section>
              );
            })
          )}

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

function Row({
  item,
  onPlay,
  onOpenArtist,
}: {
  item: MediaItem;
  onPlay: (item: MediaItem, action: 'now' | 'next' | 'later') => void;
  onOpenArtist?: () => void;
}) {
  const isArtist = item.kind === 'artist';
  return (
    <li className="sresult">
      <button
        type="button"
        className="sresult-main"
        onClick={() => (isArtist ? onOpenArtist?.() : onPlay(item, 'now'))}
        aria-label={isArtist ? `Albums by ${item.title}` : `Play ${item.title}`}
      >
        <span className={`sresult-art${isArtist ? ' is-round' : ''}`}>
          <RowArt src={item.art} />
        </span>
        <span className="sresult-text">
          <span className="sresult-title">{item.title}</span>
          <span className="sresult-sub">
            {item.subtitle}
            {item.year ? ` · ${item.year}` : ''}
            {item.durationSecs ? ` · ${mmss(item.durationSecs)}` : ''}
            {item.trackCount ? ` · ${item.trackCount} tracks` : ''}
          </span>
        </span>
        <span className="label sresult-badge">{serviceLabel(item.service)}</span>
      </button>

      {!isArtist && (
        <div className="sresult-tools">
          <button type="button" className="sresult-tool" aria-label={`Play ${item.title} now`} onClick={() => onPlay(item, 'now')}>
            <Play size={13} />
          </button>
          <button type="button" className="sresult-tool" aria-label={`Play ${item.title} next`} onClick={() => onPlay(item, 'next')}>
            <QueueNext size={14} />
          </button>
          <button type="button" className="sresult-tool" aria-label={`Add ${item.title} to the queue`} onClick={() => onPlay(item, 'later')}>
            <Plus size={14} />
          </button>
        </div>
      )}
    </li>
  );
}

/** A cover the art cache refuses (403, gone) falls back to the blank stock. */
function RowArt({ src }: { src?: string }) {
  const [broken, setBroken] = useState<string | undefined>();
  if (!src || broken === src) return <span className="sresult-art-blank" />;
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
