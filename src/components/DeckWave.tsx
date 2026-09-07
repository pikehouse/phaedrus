import { useCallback, useMemo, useRef, useState } from 'react';
import TunerSegment14 from './TunerSegment14';
import { mmss } from '../lib/format';
import { wavePath, waveform } from './DeckSignal';
import '../styles/deck.css';

const BARS = 240;

interface Props {
  deck: 'A' | 'B';
  /** No title means no track: the glass goes dark. */
  title?: string;
  artist?: string;
  seed: number;
  /** Seconds into the track. Omit on a deck that is only cued up. */
  position?: number;
  duration?: number;
  /** A stream: no length, no seeking, a breathing bed instead of a programme. */
  live?: boolean;
  onSeek?: (secs: number) => void;
}

/** "00:58" — minutes are padded so the readout never changes width. */
function clock(secs: number): string {
  const s = mmss(secs);
  return s.length === 4 ? `0${s}` : s;
}

/**
 * One display strip: smoked glass with a coral waveform behind it. Deck A
 * carries the playing track — the played run lit, a white playhead, a clock
 * at either end — and seeks on click or drag. Deck B carries the next track,
 * all dim. The bars are one SVG path drawn twice; the lit copy is clipped to
 * the played fraction, so a frame is one style write, not 480 elements.
 */
export default function DeckWave({ deck, title, artist, seed, position, duration = 0, live, onSeek }: Props) {
  const field = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const empty = !title;
  const path = useMemo(() => (empty ? '' : wavePath(waveform(seed, BARS, !!live))), [seed, empty, live]);

  const pos = scrub ?? position;
  const played =
    !live && pos !== undefined && duration > 0 ? Math.max(0, Math.min(1, pos / duration)) : undefined;
  const seekable = !!onSeek && !live && duration > 0;

  const secsAt = useCallback(
    (clientX: number) => {
      const el = field.current;
      if (!el || duration <= 0) return 0;
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
    },
    [duration],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!seekable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrub(secsAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (scrub === null) return;
    setScrub(secsAt(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (scrub === null) return;
    const target = secsAt(e.clientX);
    setScrub(null);
    onSeek?.(target);
  };

  const cls = `dwave dwave-${deck.toLowerCase()}${live ? ' is-live' : ''}${empty ? ' is-empty' : ''}${
    scrub !== null ? ' is-scrubbing' : ''
  }`;

  return (
    <div className={cls}>
      <div className="dwave-glass">
        {empty ? (
          <span className="dwave-none">
            <span className="dwave-badge" aria-hidden="true">
              {deck}
            </span>
            No track loaded
          </span>
        ) : (
          <>
            <div className="dwave-head">
              <span className="dwave-badge" aria-hidden="true">
                {deck}
              </span>
              <span className="dwave-title" title={title}>
                {title}
              </span>
              {artist && (
                <span className="dwave-artist" title={artist}>
                  {artist}
                </span>
              )}
              <span className={`dwave-tag${live ? ' is-live' : ''}`}>{live ? 'Live' : mmss(duration)}</span>
            </div>

            <div className="dwave-body">
              {pos !== undefined && (
                <span className="dwave-readout">
                  <TunerSegment14 text={clock(pos)} className="dwave-seg" label={`${mmss(pos)} elapsed`} />
                </span>
              )}

              <div
                className="dwave-field"
                ref={field}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                {...(seekable
                  ? {
                      role: 'slider' as const,
                      tabIndex: 0,
                      'aria-label': 'Seek',
                      'aria-valuemin': 0,
                      'aria-valuemax': Math.round(duration),
                      'aria-valuenow': Math.round(pos ?? 0),
                      'aria-valuetext': `${mmss(pos ?? 0)} of ${mmss(duration)}`,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === 'ArrowLeft') onSeek?.((pos ?? 0) - 10);
                        if (e.key === 'ArrowRight') onSeek?.((pos ?? 0) + 10);
                      },
                    }
                  : { 'aria-hidden': true })}
              >
                <svg
                  className="dwave-svg dwave-dim"
                  viewBox={`0 0 ${BARS} 64`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d={path} />
                </svg>
                {played !== undefined && (
                  <svg
                    className="dwave-svg dwave-lit"
                    viewBox={`0 0 ${BARS} 64`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    style={{ clipPath: `inset(0 ${(100 - played * 100).toFixed(2)}% 0 0)` }}
                  >
                    <path d={path} />
                  </svg>
                )}
                <i className="dwave-centre" aria-hidden="true" />
                {played !== undefined && (
                  <i className="dwave-playhead" style={{ left: `${(played * 100).toFixed(2)}%` }} aria-hidden="true" />
                )}
              </div>

              {played !== undefined && pos !== undefined && (
                <span className="dwave-readout dwave-readout-end">
                  <TunerSegment14
                    text={`-${clock(Math.max(0, duration - pos))}`}
                    className="dwave-seg"
                    label={`${mmss(Math.max(0, duration - pos))} remaining`}
                  />
                </span>
              )}
            </div>
          </>
        )}
        <i className="dwave-reflect" aria-hidden="true" />
      </div>
    </div>
  );
}
