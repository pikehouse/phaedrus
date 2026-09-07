import { useSonos } from '../store/useSonos';
import '../styles/deck.css';

const PADS = [1, 2, 3, 4, 5, 6, 7, 8];
const two = (n: number) => String(n).padStart(2, '0');

/**
 * Eight rubber performance pads wired to the head of the queue. A pad lights
 * pink when there is a track under it, goes dark when there is not, and the
 * one that is playing burns brighter and breathes. Pressing one jumps the
 * queue — the only cue a Sonos can actually hit.
 */
export default function DeckPads() {
  const queue = useSonos((s) => s.queue);
  const current = useSonos((s) => s.state?.queueIndex);
  const length = useSonos((s) => s.state?.queueLength);
  const playQueueIndex = useSonos((s) => s.playQueueIndex);
  const total = length ?? queue.length;

  return (
    <div className="pads">
      <div className="pads-row">
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
      <div className="pads-foot">
        <span className="deck-silk">Hot cue</span>
        <span className="deck-silk pads-queue">
          Queue <b>{two(current ?? 0)}</b> / <b>{two(total)}</b>
        </span>
      </div>
    </div>
  );
}
