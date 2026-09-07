import { useCallback, useEffect, useRef, useState } from 'react';
import { livePosition, useSonos } from '../store/useSonos';
import { mmss } from '../lib/format';
import '../styles/progress.css';

/**
 * The interpolated needle position, ticked at ~10fps — enough for a groove,
 * cheap enough to leave running. rAF is throttled to nothing in a hidden
 * window, so we also resync whenever a fresh snapshot lands.
 */
function useLivePosition(receivedAt: number) {
  const [pos, setPos] = useState(() => livePosition(useSonos.getState()));
  useEffect(() => {
    setPos(livePosition(useSonos.getState()));
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      if (t - last > 100) {
        last = t;
        setPos(livePosition(useSonos.getState()));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [receivedAt]);
  return pos;
}

export default function Progress() {
  const state = useSonos((s) => s.state);
  const receivedAt = useSonos((s) => s.receivedAt);
  const seekTo = useSonos((s) => s.seekTo);
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const live = useLivePosition(receivedAt);

  const duration = state?.durationSecs ?? 0;
  const position = scrub ?? live;

  const secsAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return 0;
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
    },
    [duration],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (duration <= 0) return;
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
    void seekTo(target);
  };

  if (!state) return null;

  if (state.isRadio) {
    return (
      <div className="progress progress-live">
        <span className="live-pip" aria-hidden="true" />
        <span className="label">Live</span>
        <span className="progress-live-rule" />
        <span className="num progress-time">{mmss(live)}</span>
      </div>
    );
  }

  const pct = duration > 0 ? Math.max(0, Math.min(1, position / duration)) * 100 : 0;

  return (
    <div className="progress">
      <span className="num progress-time">{mmss(position)}</span>
      <div
        className={`progress-track${scrub !== null ? ' is-scrubbing' : ''}`}
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${mmss(position)} of ${mmss(duration)}`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') void seekTo(position - 10);
          if (e.key === 'ArrowRight') void seekTo(position + 10);
        }}
      >
        <div className="progress-groove" />
        <div className="progress-played" style={{ width: `${pct}%` }} />
        <div className="progress-cap" style={{ left: `${pct}%` }} />
      </div>
      <span className="num progress-time progress-total">{mmss(duration)}</span>
    </div>
  );
}
