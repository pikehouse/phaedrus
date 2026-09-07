import { useEffect, useRef } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   THE GRID

   A ground plane seen from the driver's seat. The camera sits one unit above
   it, so a rung `d` units ahead lands H / d px below the horizon: the near
   edge is d = 1 at the bottom of the box, the horizon is d → ∞. Rails run
   from evenly spaced points on the near edge to the vanishing point.

   Rungs are one SVG path rebuilt per frame while the road is moving; rails
   are static and only redrawn on resize. Speed is a velocity that eases
   toward its target rather than an animation we pause, so a stop coasts and
   a start winds up — the same idea as the record in Vinyl.tsx.
   ══════════════════════════════════════════════════════════════════════════ */

const CELL = 0.5; // depth of one cell, in near-edge units
const LATERAL = 0.36; // rail pitch at the near edge, as a fraction of the box height
const CELL_SECONDS = 1.6; // one rung passes under the car every 1.6 s
const TAU_UP = 0.55;
const TAU_DOWN = 0.7; // ≈2 s from full speed to rest
const MIN_GAP = 2.4; // px between rungs before the haze takes over

interface Props {
  playing: boolean;
}

export default function DriveGrid({ playing }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const play = useRef(playing);
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const [railsGlow, rails, rungsGlow, rungs] = [...el.querySelectorAll<SVGPathElement>('path')];

    let W = 0;
    let H = 0;
    let vpx = 0;
    let phase = 0; // 0..CELL — how far the nearest rung has slid toward us
    let velocity = 0; // cells per second
    let raf = 0;
    let last = 0;

    const drawRails = () => {
      const pitch = H * LATERAL;
      if (pitch < 4 || W === 0) return;
      const n = Math.ceil(Math.max(vpx, W - vpx) / pitch) + 1;
      let d = '';
      for (let m = -n; m <= n; m++) {
        d += `M${(vpx + m * pitch).toFixed(1)} ${H.toFixed(1)}L${vpx.toFixed(1)} 0`;
      }
      rails.setAttribute('d', d);
      railsGlow.setAttribute('d', d);
    };

    const drawRungs = () => {
      let d = '';
      let prev = Infinity;
      for (let n = 1; n < 200; n++) {
        const y = H / (1 + n * CELL - phase);
        if (prev - y < MIN_GAP) break;
        prev = y;
        d += `M0 ${y.toFixed(2)}H${W.toFixed(1)}`;
      }
      rungs.setAttribute('d', d);
      rungsGlow.setAttribute('d', d);
    };

    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    };

    const step = (ts: number) => {
      raf = requestAnimationFrame(step);
      if (!last) {
        last = ts;
        return;
      }
      const dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      const target = play.current ? 1 / CELL_SECONDS : 0;
      const tau = target > velocity ? TAU_UP : TAU_DOWN;
      velocity += (target - velocity) * (1 - Math.exp(-dt / tau));
      if (target === 0 && velocity < 0.004) velocity = 0;
      if (velocity === 0) {
        stop(); // genuinely still — give the frame budget back
        return;
      }
      phase = (phase + velocity * CELL * dt) % CELL;
      drawRungs();
    };

    const nudge = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(step);
    };

    // The vanishing point is a CSS variable so the sun and the road agree.
    const measure = () => {
      const r = el.getBoundingClientRect();
      W = r.width;
      H = r.height;
      const vp = parseFloat(getComputedStyle(el).getPropertyValue('--vp'));
      vpx = Number.isFinite(vp) ? (W * vp) / 100 : W / 2;
      drawRails();
      drawRungs();
    };

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return () => ro.disconnect();
    }

    wake.current = nudge;
    const onVisibility = () => (document.hidden ? stop() : nudge());
    document.addEventListener('visibilitychange', onVisibility);
    nudge();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      wake.current = null;
    };
  }, []);

  // Play/pause only nudges the loop; the road keeps its phase across a pause.
  useEffect(() => {
    play.current = playing;
    wake.current?.();
  }, [playing]);

  return (
    <div className="drive-ground" ref={host} aria-hidden="true">
      <svg className="drive-grid" width="100%" height="100%">
        <path className="drive-grid-rails-glow" />
        <path className="drive-grid-rails" />
        <path className="drive-grid-rungs-glow" />
        <path className="drive-grid-rungs" />
      </svg>
    </div>
  );
}
