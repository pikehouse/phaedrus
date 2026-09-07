import { useEffect, useRef } from 'react';
import '../styles/vinyl.css';

// Real 33⅓ rpm is a turn every 1.8s, which is hard to look at from across
// the room. This is a lazy, hypnotic third of that — a turn every ~5s.
const RPM_DEG_PER_SEC = 75;
const TAU_UP = 0.6; // ≈2s to reach speed
const TAU_DOWN = 0.9; // ≈3s to coast to rest — heavier than it starts

interface Props {
  art?: string;
  playing: boolean;
  title?: string;
  onArtError?: () => void;
}

/**
 * The disc alone. A velocity that eases toward its target rather than an
 * animation we pause, so stopping coasts and starting winds up.
 */
export default function Vinyl({ art, playing, title, onArtError }: Props) {
  const discRef = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const velocity = useRef(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let idleFrames = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const target = playing ? RPM_DEG_PER_SEC : 0;
      const tau = target > velocity.current ? TAU_UP : TAU_DOWN;
      velocity.current += (target - velocity.current) * (1 - Math.exp(-dt / tau));
      if (Math.abs(velocity.current) < 0.35 && target === 0) velocity.current = 0;

      if (velocity.current !== 0) {
        angle.current = (angle.current + velocity.current * dt) % 360;
        idleFrames = 0;
      } else {
        idleFrames++;
      }
      if (discRef.current) discRef.current.style.transform = `rotate(${angle.current}deg)`;

      if (idleFrames > 4 && !playing) return; // park the loop once genuinely still
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div className="vinyl">
      <div className="vinyl-disc" ref={discRef}>
        <div className="vinyl-grooves" />
        <div className="vinyl-label">
          {art ? (
            <img
              src={art}
              alt={title ? `Label art for ${title}` : ''}
              draggable={false}
              onError={onArtError}
            />
          ) : (
            <div className="vinyl-label-blank" aria-hidden="true">
              <span>PHÆDRUS</span>
              <i />
            </div>
          )}
        </div>
        <div className="vinyl-label-ring" />
      </div>
      <div className="vinyl-sheen" aria-hidden="true" />
      <div className="vinyl-spindle" aria-hidden="true" />
    </div>
  );
}
