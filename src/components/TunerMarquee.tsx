import { useEffect, useRef } from 'react';
import '../styles/tuner.css';

/** Blank run between the end of the line and the start of its repeat.
    Must match `gap` on `.tmarq-track` in tuner.css. */
const GAP_PX = 72;

interface Props {
  text: string;
  /** Pixels per second. A 1988 display crawls; 50 is about right. */
  speed?: number;
  /** How long the head of the line sits still before it starts to move. */
  pauseMs?: number;
  className?: string;
}

/**
 * The text line off a late-80s CD player: it holds for a beat, crawls left at
 * a constant speed whatever the length, and the copy behind it makes the wrap
 * seamless. Driven with the Web Animations API — the duration depends on the
 * measured text width, which a fixed @keyframes rule cannot express, and it
 * keeps the whole thing off React's render path.
 */
export default function TunerMarquee({ text, speed = 50, pauseMs = 1500, className }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const seg = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const vp = viewport.current;
    const tr = track.current;
    const sg = seg.current;
    if (!vp || !tr || !sg) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let anim: Animation | null = null;

    const measure = () => {
      anim?.cancel();
      anim = null;
      tr.style.transform = 'none';

      // `is-still` must never change what this measures: the segment always
      // sits at its natural width (the viewport clips it), so a line that has
      // stopped scrolling can still be seen to overflow again when the panel
      // narrows or the track changes.
      const w = sg.getBoundingClientRect().width;
      const room = vp.getBoundingClientRect().width;
      // A line that fits is simply printed — real players don't scroll those.
      const still = reduced || w < 4 || w <= room + 1;
      vp.classList.toggle('is-still', still);
      if (still) return;

      const shift = w + GAP_PX;
      const travel = (shift / speed) * 1000;
      const total = travel + pauseMs;
      anim = tr.animate(
        [
          { transform: 'translateX(0)', offset: 0 },
          { transform: 'translateX(0)', offset: pauseMs / total },
          { transform: `translateX(${-shift}px)`, offset: 1 },
        ],
        { duration: total, iterations: Infinity, easing: 'linear' },
      );
      if (document.hidden) anim.pause();
    };

    measure();

    // Re-time on a container resize or a late web-font swap, so the crawl is
    // always the same speed rather than the same duration.
    const ro = new ResizeObserver(measure);
    ro.observe(sg);
    ro.observe(vp);

    const onVisibility = () => {
      if (!anim) return;
      if (document.hidden) anim.pause();
      else void anim.play();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      anim?.cancel();
    };
  }, [text, speed, pauseMs]);

  return (
    <div className={`tmarq${className ? ` ${className}` : ''}`} ref={viewport}>
      <div className="tmarq-track" ref={track}>
        <span className="tmarq-seg" ref={seg}>
          {text}
        </span>
        <span className="tmarq-seg" aria-hidden="true">
          {text}
        </span>
      </div>
    </div>
  );
}
