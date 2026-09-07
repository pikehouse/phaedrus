import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const SWEEP_MS = 2400; // must match the drive-sweep keyframes
const GAP_MIN_MS = 8000;
const GAP_MAX_MS = 11000;

/**
 * What the whole window is seen through: fine scanlines, and — while the car
 * is moving — a streetlight sliding across everything every nine seconds or
 * so. Rendered on <body> because the stage is a layout container and would
 * otherwise keep a fixed element inside its own box.
 */
export default function DriveFilm({ playing }: { playing: boolean }) {
  const [passing, setPassing] = useState(false);

  useEffect(() => {
    if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    let end = 0;
    let cancelled = false;

    const schedule = () => {
      timer = window.setTimeout(fire, GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS));
    };
    const fire = () => {
      setPassing(true);
      end = window.setTimeout(() => {
        setPassing(false);
        if (!cancelled) schedule();
      }, SWEEP_MS);
    };
    const onVisibility = () => {
      clearTimeout(timer);
      clearTimeout(end);
      setPassing(false);
      if (!document.hidden) schedule();
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // A lamp we are already under finishes passing; the next one never comes.
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [playing]);

  return createPortal(
    <>
      <i className="drive-scan" aria-hidden="true" />
      <i className={`drive-sweep${passing ? ' is-passing' : ''}`} aria-hidden="true" />
    </>,
    document.body,
  );
}
