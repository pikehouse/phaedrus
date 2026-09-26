import { useSonos } from '../store/useSonos';
import '../styles/deck.css';

const PADS = [1, 2, 3, 4, 5, 6, 7, 8];
const two = (n: number) => String(n).padStart(2, '0');

/**
 * Eight rubber performance pads in a 4×2 block, wired to the head of the
 * queue. Unlit pads are dark rubber with a faint pink edge; a pad with a
 * track under it glows dimly from beneath; only the one that is playing is
 * lit, softly. Pressing one jumps the queue — the only cue a Sonos can hit.
 */
export default function DeckPads() {
  const queue = useSonos((s) => s.queue);
  const current = useSonos((s) => s.state?.queueIndex);
  const length = useSonos((s) => s.state?.queueLength);
  const playQueueIndex = useSonos((s) => s.playQueueIndex);
  const total = length ?? queue.length;

  return (
    <div className="pads">
      <div className="pads-head">
        <span className="deck-silk">Performance pads</span>
        <span className="deck-silk pads-mode">Hot cue</span>
        <span className="deck-silk pads-queue">
          Queue <b>{two(current ?? 0)}</b> / <b>{two(total)}</b>
        </span>
      </div>
      <div className="pads-grid">
        {PADS.map((n) => {
          const item = queue.find((q) => q.index === n);
          const on = current === n;
          return (
            <button
              key={n}
              type="button"
              className={`pad${item ? ' is-loaded' : ''}${on ? ' is-current' : ''}`}
              disabled={!item}
              onClick={() => void playQueueIndex(n)}
              aria-label={item ? `Hot cue ${n} — ${item.title}` : `Hot cue ${n}, empty`}
              aria-pressed={on}
              title={item?.title}
            >
              <span className="pad-n" aria-hidden="true">
                {n}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
