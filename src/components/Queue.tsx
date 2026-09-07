import { useEffect, useRef, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { mmss } from '../lib/format';
import { Close } from './Icons';
import '../styles/queue.css';

export default function Queue() {
  const queue = useSonos((s) => s.queue);
  const total = useSonos((s) => s.queueTotal);
  const currentIndex = useSonos((s) => s.state?.queueIndex);
  const playing = useSonos((s) => s.state?.state === 'PLAYING');
  const playQueueIndex = useSonos((s) => s.playQueueIndex);
  const removeFromQueue = useSonos((s) => s.removeFromQueue);
  const clearQueue = useSonos((s) => s.clearQueue);

  const listRef = useRef<HTMLUListElement>(null);
  const currentRef = useRef<HTMLLIElement>(null);
  const hovering = useRef(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Follow the record, but never yank the list out from under a pointer.
  useEffect(() => {
    if (hovering.current || !currentRef.current) return;
    currentRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentIndex]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3200);
    return () => clearTimeout(t);
  }, [confirmClear]);

  return (
    <div className="panel">
      <header className="panel-head">
        <span className="panel-count num">
          {total || queue.length} {(total || queue.length) === 1 ? 'track' : 'tracks'}
        </span>
        {queue.length > 0 && (
          <button
            type="button"
            className={`panel-action${confirmClear ? ' is-armed' : ''}`}
            onClick={() => {
              if (confirmClear) {
                setConfirmClear(false);
                void clearQueue();
              } else {
                setConfirmClear(true);
              }
            }}
          >
            {confirmClear ? 'sure?' : 'clear'}
          </button>
        )}
      </header>

      <ul
        className="queue scroll"
        ref={listRef}
        onMouseEnter={() => {
          hovering.current = true;
        }}
        onMouseLeave={() => {
          hovering.current = false;
        }}
      >
        {queue.map((item) => {
          const current = item.index === currentIndex;
          return (
            <li key={`${item.index}-${item.uri}`} ref={current ? currentRef : undefined}>
              <div className={`qrow${current ? ' is-current' : ''}`}>
                <button
                  type="button"
                  className="qrow-main"
                  onClick={() => void playQueueIndex(item.index)}
                  aria-label={`Play ${item.title}`}
                  aria-current={current}
                >
                  <span className="qrow-marker" aria-hidden="true" />
                  <span className="qrow-art">
                    {item.art ? (
                      <img src={item.art} alt="" loading="lazy" draggable={false} />
                    ) : (
                      <span className="qrow-art-blank" />
                    )}
                    {current && playing && <span className="qrow-art-glow" aria-hidden="true" />}
                  </span>
                  <span className="qrow-text">
                    <span className="qrow-title">{item.title}</span>
                    <span className="qrow-artist">{item.artist ?? '—'}</span>
                  </span>
                  <span className="num qrow-time">{mmss(item.durationSecs)}</span>
                </button>
                <button
                  type="button"
                  className="qrow-remove"
                  aria-label={`Remove ${item.title} from queue`}
                  onClick={() => void removeFromQueue(item.index)}
                >
                  <Close size={13} />
                </button>
              </div>
            </li>
          );
        })}

        {queue.length === 0 && (
          <li className="panel-empty">
            <p className="panel-empty-line">The queue is empty.</p>
            <p className="panel-empty-sub">Pull something from the crate.</p>
          </li>
        )}
      </ul>
    </div>
  );
}
