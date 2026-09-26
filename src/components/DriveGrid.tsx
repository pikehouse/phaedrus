import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

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
const ROAD = 1.25; // road half-width, in rail pitches
const LINE = 0.028; // centre-line half-width, in rail pitches
const DASH_PERIOD = 2 * CELL; // one dash every two cells…
const DASH_LEN = 0.42 * DASH_PERIOD; // …and a little under half of it painted

interface Props {
  playing: boolean;
}

export default function DriveGrid({ playing }: Props) {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const play = useRef(playing);
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const $ = (c: string) => el.querySelector<SVGPathElement>(`.${c}`)!;
    const [railsGlow, rails, rungsGlow, rungs] = ['rails-glow', 'rails', 'rungs-glow', 'rungs'].map((c) =>
      $(`drive-grid-${c}`),
    );
    const [road, edgesGlow, edges, dashGlow, dashes] = ['road', 'edges-glow', 'edges', 'dash-glow', 'dash'].map(
      (c) => $(`drive-road-${c}`),
    );

    let W = 0;
    let H = 0;
    let vpx = 0;
    let travel = 0; // how far the car has gone, in near-edge units (mod a long cycle)
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

      // The road: a darker strip over the grid, with a painted edge each side.
      const half = ROAD * pitch;
      const v = `${vpx.toFixed(1)} 0`;
      road.setAttribute('d', `M${v}L${(vpx + half).toFixed(1)} ${H.toFixed(1)}H${(vpx - half).toFixed(1)}Z`);
      const e = `M${(vpx - half).toFixed(1)} ${H.toFixed(1)}L${v}L${(vpx + half).toFixed(1)} ${H.toFixed(1)}`;
      edges.setAttribute('d', e);
      edgesGlow.setAttribute('d', e);
    };

    // The centre line: trapezoids on the ground plane, sliding with the rungs.
    const drawDashes = () => {
      const pitch = H * LATERAL;
      if (pitch < 4 || W === 0) return;
      const off = travel % DASH_PERIOD;
      const hw = LINE * pitch;
      let d = '';
      for (let k = 1; k < 120; k++) {
        const near = Math.max(0.35, k * DASH_PERIOD - off);
        const far = k * DASH_PERIOD - off + DASH_LEN;
        if (far <= 0.35) continue;
        const y1 = H / near;
        const y2 = H / far;
        if (y1 - y2 < 0.7) break;
        const x1 = hw / near;
        const x2 = hw / far;
        d +=
          `M${(vpx - x1).toFixed(2)} ${y1.toFixed(2)}L${(vpx - x2).toFixed(2)} ${y2.toFixed(2)}` +
          `L${(vpx + x2).toFixed(2)} ${y2.toFixed(2)}L${(vpx + x1).toFixed(2)} ${y1.toFixed(2)}Z`;
      }
      dashes.setAttribute('d', d);
      dashGlow.setAttribute('d', d);
    };

    const drawRungs = () => {
      let d = '';
      let prev = Infinity;
      for (let n = 1; n < 200; n++) {
        const y = H / (1 + n * CELL - (travel % CELL));
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
      // One shared odometer, so the rungs and the centre line stop together.
      travel = (travel + velocity * CELL * dt) % (CELL * DASH_PERIOD * 64);
      drawRungs();
      drawDashes();
    };

    const nudge = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(step);
    };

    // The road runs out under the sun: its centre is measured, not assumed,
    // so every layout (side by side, eclipse, phone) agrees with itself.
    const sun = el.parentElement?.querySelector<HTMLElement>('.drive-sun') ?? null;
    const measure = () => {
      const r = el.getBoundingClientRect();
      W = r.width;
      H = r.height;
      if (sun) {
        const s = sun.getBoundingClientRect();
        vpx = s.left + s.width / 2 - r.left;
      } else {
        vpx = W / 2;
      }
      drawRails();
      drawRungs();
      drawDashes();
    };

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (sun) ro.observe(sun);
    measure();

    if (reduced) {
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
  }, [reduced]);

  // Play/pause only nudges the loop; the road keeps its place across a pause.
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
        <path className="drive-road-road" />
        <path className="drive-road-edges-glow" />
        <path className="drive-road-edges" />
        <path className="drive-road-dash-glow" />
        <path className="drive-road-dash" />
      </svg>
    </div>
  );
}
