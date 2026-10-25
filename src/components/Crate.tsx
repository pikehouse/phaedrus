import { useEffect, useRef, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { useSkin } from '../store/skin';
import { useLongPress } from '../hooks/useLongPress';
import { pickBy } from '../lib/hash';
import { serviceLabel } from '../lib/format';
import { Plus, QueueNext } from './Icons';
import type { Favorite } from '../api/types';
import '../styles/crate.css';

// Sleeve stocks for favourites with no artwork.
const GROUNDS = ['walnut', 'burgundy', 'olive', 'mustard', 'wine'] as const;

// Nightdrive's filter keys: which favourites each one shows.
type Filter = 'all' | 'albums' | 'playlists' | 'radio';
const FILTERS: { id: Filter; label: string; kind?: Favorite['kind'] }[] = [
  { id: 'all', label: 'All' },
  { id: 'albums', label: 'Albums', kind: 'album' },
  { id: 'playlists', label: 'Playlists', kind: 'playlist' },
  { id: 'radio', label: 'Radio', kind: 'station' },
];

export default function Crate() {
  const favorites = useSonos((s) => s.favorites);
  const playFavorite = useSonos((s) => s.playFavorite);
  const playFavoriteTap = useSonos((s) => s.playFavoriteTap);
  const filtered = useSkin((s) => s.skin === 'nightdrive');
  const [filter, setFilter] = useState<Filter>('all');
  const kind = filtered ? FILTERS.find((f) => f.id === filter)?.kind : undefined;
  const shown = kind ? favorites.filter((f) => f.kind === kind) : favorites;

  return (
    <div className="panel">
      <header className="panel-head">
        <span className="panel-count num">
          {favorites.length} {favorites.length === 1 ? 'favourite' : 'favourites'}
        </span>
      </header>

      {filtered && (
        <div className="crate-filters" role="radiogroup" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              className={`crate-filter${filter === f.id ? ' is-on' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="crate scroll">
        {shown.map((f) => (
          <Sleeve
            key={f.id}
            fav={f}
            onPlay={(action) => void (action === 'replace' ? playFavoriteTap(f) : playFavorite(f, action))}
          />
        ))}
        {favorites.length === 0 && (
          <p className="panel-empty-line crate-empty">No Sonos favourites yet.</p>
        )}
        {favorites.length > 0 && shown.length === 0 && (
          <p className="panel-empty-line crate-empty">Nothing here in your favourites.</p>
        )}
      </div>
    </div>
  );
}

function Sleeve({
  fav,
  onPlay,
}: {
  fav: Favorite;
  onPlay: (action: 'replace' | 'next' | 'later') => void;
}) {
  const ground = pickBy(fav.title, GROUNDS);
  const queueable = fav.playable && fav.kind !== 'station';

  // A finger cannot hover: holding the sleeve for half a second brings its
  // tools up instead, and a tap anywhere else puts them away.
  const [held, setHeld] = useState(false);
  const item = useRef<HTMLDivElement>(null);
  const press = useLongPress(() => setHeld(true));

  useEffect(() => {
    if (!held) return;
    const away = (e: PointerEvent) => {
      if (!item.current?.contains(e.target as Node)) setHeld(false);
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [held]);

  const act = (action: 'replace' | 'next' | 'later') => {
    setHeld(false);
    onPlay(action);
  };

  const [brokenArt, setBrokenArt] = useState<string | null>(null);
  const showArt = !!fav.art && brokenArt !== fav.art;

  return (
    <div ref={item} className={`crate-item${fav.playable ? '' : ' is-dim'}${held ? ' is-held' : ''}`}>
      <button
        type="button"
        className="crate-face"
        disabled={!fav.playable}
        {...(queueable ? press.handlers : undefined)}
        onClick={() => {
          if (press.consumed()) return;
          act('replace');
        }}
        onContextMenu={(e) => {
          if (queueable) e.preventDefault();
        }}
        aria-label={fav.playable ? `Play ${fav.title}` : `${fav.title} (not playable)`}
        title={fav.description ? `${fav.title} — ${fav.description}` : fav.title}
      >
        {showArt ? (
          <img
            src={fav.art}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setBrokenArt(fav.art ?? null)}
          />
        ) : (
          <span className={`crate-bill ground-${ground}`}>
            <span className="crate-bill-title">{fav.title}</span>
            {fav.service && <span className="label crate-bill-mark">{serviceLabel(fav.service)}</span>}
          </span>
        )}
        <span className="crate-wear" aria-hidden="true" />
      </button>

      {/* Siblings, not children — a button inside a button is not a button. */}
      {queueable && (
        <div className="crate-tools">
          <button
            type="button"
            className="crate-tool"
            aria-label={`Play ${fav.title} next`}
            onClick={() => act('next')}
          >
            <QueueNext size={13} />
          </button>
          <button
            type="button"
            className="crate-tool"
            aria-label={`Add ${fav.title} to the queue`}
            onClick={() => act('later')}
          >
            <Plus size={13} />
          </button>
        </div>
      )}

      <span className="crate-caption">{fav.title}</span>
      {fav.description && <span className="crate-caption-sub">{fav.description}</span>}
    </div>
  );
}
