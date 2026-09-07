import { useEffect, useRef } from 'react';
import { useSonos } from '../store/useSonos';
import { useLivePosition } from './DeckSignal';
import '../styles/deck.css';

const SEGMENTS = 60;
// 33⅓ rpm is one turn every 1.8s — the real speed, since this is a jog wheel
// and not a record you watch from across the room.
// Real 33⅓ was too fast to look at on a marker this bright; this is a
// lazy turn every ~6s, matching the hi-fi record's pace.
const DEG_PER_SEC = 60;
const TAU_UP = 0.8; // ≈2.5s to reach speed
const TAU_DOWN = 1.1; // ≈3.5s to coast to rest — heavier than it starts

/** Sixty radial LED bars, the first one centred just past twelve o'clock. */
const RING = Array.from({ length: SEGMENTS }, (_, i) => {
  const a = ((-90 + (i + 0.5) * (360 / SEGMENTS)) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return {
    x1: (100 + c * 78).toFixed(2),
    y1: (100 + s * 78).toFixed(2),
    x2: (100 + c * 86).toFixed(2),
    y2: (100 + s * 86).toFixed(2),
  };
});

/**
 * The platter: a rubber rim, a ring of orange LEDs, and the cover art in the
 * centre display. Like a CDJ, the ring tells you where you are two ways at
 * once — the lit arc is the fraction played, and one hot marker turns at
 * 33⅓ while the track plays, winding up and coasting down with the same
 * velocity model as the hi-fi's record. The art itself never spins.
 */
export default function DeckJog() {
  const state = useSonos((s) => s.state);
  const receivedAt = useSonos((s) => s.receivedAt);
  const live = useLivePosition(receivedAt);

  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const track = state?.track;
  const idle = !state || state.state === 'NO_MEDIA_PRESENT' || !track;
  const duration = state?.durationSecs ?? 0;
  const played =
    !idle && !state.isRadio && duration > 0 ? Math.max(0, Math.min(1, live / duration)) : 0;
  const lit = Math.round(played * SEGMENTS);

  const arm = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const velocity = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let last = performance.now();
    let idleFrames = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = playing ? DEG_PER_SEC : 0;
      const tau = target > velocity.current ? TAU_UP : TAU_DOWN;
      velocity.current += (target - velocity.current) * (1 - Math.exp(-dt / tau));
      if (Math.abs(velocity.current) < 0.5 && target === 0) velocity.current = 0;

      if (velocity.current !== 0) {
        angle.current = (angle.current + velocity.current * dt) % 360;
        idleFrames = 0;
      } else {
        idleFrames++;
      }
      if (arm.current) arm.current.style.transform = `rotate(${angle.current.toFixed(2)}deg)`;

      if (idleFrames > 4 && !playing) return; // park the loop once genuinely still
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div className={`jog${playing ? ' is-live' : ''}${idle ? ' is-idle' : ''}`}>
      <i className="jog-rubber" aria-hidden="true" />
      <svg className="jog-ring" viewBox="0 0 200 200" aria-hidden="true">
        {RING.map((p, i) => (
          <line key={i} {...p} className={`jog-led${i < lit ? ' is-lit' : ''}`} />
        ))}
      </svg>
      <div className="jog-arm" ref={arm} aria-hidden="true">
        <i className="jog-marker" />
      </div>
      <div className="jog-centre">
        {!idle && track?.art ? (
          <img src={track.art} alt={track.title ? `Album art for ${track.title}` : ''} draggable={false} />
        ) : (
          <span className="jog-brand" aria-hidden="true">
            PHÆDRUS
          </span>
        )}
        <i className="jog-glass" aria-hidden="true" />
      </div>
    </div>
  );
}
