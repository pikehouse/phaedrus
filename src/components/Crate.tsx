import { useSonos } from '../store/useSonos';
import { pickBy } from '../lib/hash';
import { serviceLabel } from '../lib/format';
import { Plus, QueueNext } from './Icons';
import type { Favorite } from '../api/types';
import '../styles/crate.css';

// Sleeve stocks for favourites with no artwork.
const GROUNDS = ['walnut', 'burgundy', 'olive', 'mustard', 'wine'] as const;

export default function Crate() {
  const favorites = useSonos((s) => s.favorites);
  const playFavorite = useSonos((s) => s.playFavorite);

  return (
    <div className="panel">
      <header className="panel-head">
        <span className="panel-count num">
          {favorites.length} {favorites.length === 1 ? 'favourite' : 'favourites'}
        </span>
      </header>

      <div className="crate scroll">
        {favorites.map((f) => (
          <Sleeve key={f.id} fav={f} onPlay={(action) => void playFavorite(f, action)} />
        ))}
        {favorites.length === 0 && (
          <p className="panel-empty-line crate-empty">No Sonos favourites yet.</p>
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

  return (
    <div className={`sleeve${fav.playable ? '' : ' is-dim'}`}>
      <button
        type="button"
        className="sleeve-face"
        disabled={!fav.playable}
        onClick={() => onPlay('replace')}
        aria-label={fav.playable ? `Play ${fav.title}` : `${fav.title} (not playable)`}
        title={fav.description ? `${fav.title} — ${fav.description}` : fav.title}
      >
        {fav.art ? (
          <img src={fav.art} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className={`sleeve-print ground-${ground}`}>
            <span className="sleeve-print-title">{fav.title}</span>
            {fav.service && <span className="label sleeve-print-mark">{serviceLabel(fav.service)}</span>}
          </span>
        )}
        <span className="sleeve-wear" aria-hidden="true" />
      </button>

      {/* Siblings, not children — a button inside a button is not a button. */}
      {queueable && (
        <div className="sleeve-tools">
          <button
            type="button"
            className="sleeve-tool"
            aria-label={`Play ${fav.title} next`}
            onClick={() => onPlay('next')}
          >
            <QueueNext size={13} />
          </button>
          <button
            type="button"
            className="sleeve-tool"
            aria-label={`Add ${fav.title} to the queue`}
            onClick={() => onPlay('later')}
          >
            <Plus size={13} />
          </button>
        </div>
      )}

      <span className="sleeve-title">{fav.title}</span>
      {fav.description && <span className="sleeve-sub">{fav.description}</span>}
    </div>
  );
}
