import { useLayoutEffect, useMemo, useRef, useState } from 'react';

/* ══════════════════════════════════════════════════════════════════════════
   THE WORLD BEHIND THE GLASS

   Everything above the road that is not the sun: a sparse sky of stars, two
   ridges of hills catching the last rim of the sunset, and a distant city
   along the horizon with a handful of lit windows and one red beacon.

   The sun is rendered here too, because it has to sit between the stars and
   the hills. Everything is drawn in real pixels from the measured sky, and
   the whole thing is seeded — the same city every night, not a new one per
   track. Where the sun sits is measured, not assumed, so the valley in the
   hills and the gap in the skyline follow it in every layout.
   ══════════════════════════════════════════════════════════════════════════ */

interface Geom {
  /** Sky width and height in px; the bottom edge is the horizon. */
  w: number;
  h: number;
  /** The sun's centre x and diameter, in px. */
  vp: number;
  sun: number;
}

/** mulberry32: small, fast, and the same numbers every time. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (n: number) => n.toFixed(1);

interface Star {
  x: number;
  y: number;
  r: number;
  o: number;
  /** Twinkle period in seconds, or 0 for a star that just burns. */
  tw: number;
  delay: number;
}

function makeStars({ w, h }: Geom): Star[] {
  const rnd = prng(0x5eed);
  // A few, not a screensaver: about one per 11 000 px² of sky, capped.
  const n = Math.round(Math.min(46, Math.max(14, (w * h) / 11000)));
  const out: Star[] = [];
  for (let i = 0; i < n; i++) {
    // Denser high up; the sunset band near the horizon washes them out.
    const y = Math.pow(rnd(), 1.5) * h * 0.66;
    const bright = rnd() < 0.14;
    out.push({
      x: rnd() * w,
      y,
      r: bright ? 1.05 + rnd() * 0.35 : 0.45 + rnd() * 0.45,
      o: (bright ? 0.8 : 0.3 + rnd() * 0.4) * (1 - (y / (h * 0.66)) * 0.55),
      tw: rnd() < 0.4 ? 7 + rnd() * 9 : 0,
      delay: -rnd() * 16,
    });
  }
  return out;
}

/** A ridge: a sum of slow sines, pressed down into a valley where the sun sets. */
function ridge(g: Geom, seed: number, peak: number, base: number, valley: number): string {
  const rnd = prng(seed);
  const waves = [0, 1, 2, 3].map((k) => ({
    f: (0.9 + rnd() * 0.8) * (k + 1) * 1.7,
    p: rnd() * Math.PI * 2,
    a: 1 / (k + 1.3),
  }));
  const norm = waves.reduce((s, v) => s + v.a, 0);
  const step = 6;
  let d = `M0 ${f1(g.h + 1)}`;
  for (let x = 0; x <= g.w + step; x += step) {
    const u = x / Math.max(1, g.w);
    let s = 0;
    for (const v of waves) s += v.a * (0.5 + 0.5 * Math.sin(u * v.f * Math.PI + v.p));
    const dip = 1 - valley * Math.exp(-(((x - g.vp) / (g.sun * 0.85)) ** 2));
    const y = g.h - base - (s / norm) * peak * dip;
    d += `L${f1(Math.min(x, g.w))} ${f1(y)}`;
  }
  return `${d}L${f1(g.w)} ${f1(g.h + 1)}Z`;
}

/** Just the top edge of a ridge path, for the rim light. */
function rimOf(path: string): string {
  const pts = path.slice(1, -1).split('L');
  return `M${pts.slice(1, -1).join('L')}`;
}

interface City {
  body: string;
  windows: { x: number; y: number; o: number }[];
  beacon: { x: number; y: number } | null;
}

function makeCity(g: Geom): City {
  const rnd = prng(0xc17);
  const tall = g.h * 0.2;
  // Downtown clusters between the cover and the sun; a smaller one past it.
  const c1 = g.vp - g.sun * 1.25;
  const c2 = g.vp + g.sun * 1.05;
  const spread = Math.max(60, g.w * 0.08);
  let d = '';
  const windows: City['windows'] = [];
  let beacon: City['beacon'] = null;
  let best = 0;
  let x = -4;
  while (x < g.w + 4) {
    const bw = 5 + rnd() * 15;
    const k1 = Math.exp(-(((x - c1) / spread) ** 2));
    const k2 = 0.55 * Math.exp(-(((x - c2) / (spread * 0.7)) ** 2));
    const cluster = Math.max(k1, k2);
    // Low roofs everywhere, towers where the clusters are, and the sun's
    // own disc left mostly clear so its stripes set behind low rooftops.
    const nearSun = Math.abs(x + bw / 2 - g.vp) < g.sun * 0.34 ? 0.25 : 1;
    let bh = (2 + rnd() * 6 + cluster * tall * (0.35 + rnd() * 0.65)) * nearSun;
    if (rnd() < 0.18) bh *= 0.4;
    bh = Math.max(1.5, bh);
    const top = g.h - bh;
    d += `M${f1(x)} ${f1(g.h + 1)}V${f1(top)}`;
    // A stepped crown on some of the tall ones.
    if (bh > tall * 0.45 && rnd() < 0.45) {
      const inset = bw * 0.22;
      const step = 2 + rnd() * 3;
      d += `H${f1(x + inset)}V${f1(top - step)}H${f1(x + bw - inset)}V${f1(top)}`;
      if (rnd() < 0.5) {
        const mx = x + bw / 2;
        d += `H${f1(mx + 0.5)}V${f1(top - step - 4 - rnd() * 6)}H${f1(mx - 0.5)}V${f1(top)}`;
      }
    }
    d += `H${f1(x + bw)}V${f1(g.h + 1)}Z`;
    if (bh > best && nearSun === 1) {
      best = bh;
      beacon = { x: x + bw / 2, y: top - 1.8 };
    }
    // A few lit windows: a pitch of 3 px, one in twenty or so on.
    if (bh > 12) {
      for (let wy = top + 3; wy < g.h - 3; wy += 3) {
        for (let wx = x + 2; wx < x + bw - 2; wx += 3) {
          if (rnd() < 0.035) windows.push({ x: wx, y: wy, o: 0.45 + rnd() * 0.5 });
        }
      }
    }
    x += bw + (rnd() < 0.3 ? 1 + rnd() * 5 : 0);
  }
  return { body: d, windows, beacon };
}

/** Two palms by the far right of the road: the one thing that says LA. */
function palm(x: number, ground: number, hgt: number, lean: number): string {
  const topX = x + lean * hgt;
  const topY = ground - hgt;
  const w = Math.max(1.2, hgt * 0.035);
  let d = `M${f1(x - w)} ${f1(ground)}Q${f1(x + lean * hgt * 0.2 - w)} ${f1(ground - hgt * 0.55)} ${f1(topX - w * 0.5)} ${f1(topY)}L${f1(topX + w * 0.5)} ${f1(topY)}Q${f1(x + lean * hgt * 0.2 + w)} ${f1(ground - hgt * 0.55)} ${f1(x + w)} ${f1(ground)}Z`;
  const fronds = [-2.7, -2.2, -1.6, -1.0, -0.45, 0.25, 0.75];
  const len = hgt * 0.36;
  for (const a of fronds) {
    const ex = topX + Math.cos(a) * len;
    const ey = topY + Math.sin(a) * len * 0.55 + len * 0.42;
    const cx = topX + Math.cos(a) * len * 0.55;
    const cy = topY + Math.sin(a) * len * 0.75 - len * 0.1;
    const t = len * 0.06;
    d += `M${f1(topX)} ${f1(topY - t)}Q${f1(cx)} ${f1(cy - t)} ${f1(ex)} ${f1(ey)}Q${f1(cx)} ${f1(cy + t)} ${f1(topX)} ${f1(topY + t)}Z`;
  }
  return d;
}

export default function DriveWorld() {
  const land = useRef<SVGSVGElement>(null);
  const sunRef = useRef<HTMLElement>(null);
  const [g, setG] = useState<Geom | null>(null);

  useLayoutEffect(() => {
    const el = land.current;
    const sun = sunRef.current;
    if (!el || !sun) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const s = sun.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      const next = {
        w: Math.round(r.width),
        h: Math.round(r.height),
        vp: Math.round(s.left + s.width / 2 - r.left),
        sun: Math.round(s.width),
      };
      setG((p) => (p && p.w === next.w && p.h === next.h && p.vp === next.vp && p.sun === next.sun ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(sun);
    return () => ro.disconnect();
  }, []);

  const scene = useMemo(() => {
    if (!g) return null;
    const far = ridge(g, 0x411, g.h * 0.17, 0, 0.72);
    const near = ridge(g, 0x7a1, g.h * 0.085, 0, 0.5);
    const city = makeCity(g);
    const palmX = g.w - Math.max(34, g.w * 0.06);
    const palms =
      palm(palmX, g.h + 1, g.h * 0.2, -0.12) + palm(palmX + Math.max(14, g.w * 0.022), g.h + 1, g.h * 0.14, 0.1);
    // The rim is warmest right under the sun and fades to pink, then nothing.
    const u = g.vp / g.w;
    const span = Math.max(0.12, (g.sun / g.w) * 1.6);
    return { far, farRim: rimOf(far), near, nearRim: rimOf(near), city, palms, u, span, stars: makeStars(g) };
  }, [g]);

  const stops = (id: string, a: number) =>
    scene && (
      <linearGradient id={id} gradientUnits="objectBoundingBox" x1="0" x2="1" y1="0" y2="0">
        <stop offset={0} stopColor="#ff2d95" stopOpacity={0} />
        <stop offset={Math.max(0, scene.u - scene.span * 1.6)} stopColor="#ff2d95" stopOpacity={a * 0.35} />
        <stop offset={Math.max(0, scene.u - scene.span * 0.5)} stopColor="#ff6a3d" stopOpacity={a * 0.8} />
        <stop offset={scene.u} stopColor="#ffb347" stopOpacity={a} />
        <stop offset={Math.min(1, scene.u + scene.span * 0.5)} stopColor="#ff6a3d" stopOpacity={a * 0.8} />
        <stop offset={Math.min(1, scene.u + scene.span * 1.6)} stopColor="#ff2d95" stopOpacity={a * 0.35} />
        <stop offset={1} stopColor="#ff2d95" stopOpacity={0} />
      </linearGradient>
    );

  return (
    <>
      <svg className="drive-stars" aria-hidden="true" width="100%" height="100%">
        {scene?.stars.map((s, i) => (
          <circle
            key={i}
            className={s.tw ? 'drive-star is-twinkle' : 'drive-star'}
            cx={f1(s.x)}
            cy={f1(s.y)}
            r={s.r.toFixed(2)}
            style={
              {
                '--o': s.o.toFixed(2),
                animationDuration: s.tw ? `${s.tw.toFixed(1)}s` : undefined,
                animationDelay: s.tw ? `${s.delay.toFixed(1)}s` : undefined,
              } as React.CSSProperties
            }
          />
        ))}
      </svg>

      <i className="drive-sun-glow" aria-hidden="true" />
      <i className="drive-sun" ref={sunRef} aria-hidden="true" />

      <svg ref={land} className="drive-land" aria-hidden="true" width="100%" height="100%">
        {scene && g && (
          <>
            <defs>
              {stops('drive-rim-far', 0.75)}
              {stops('drive-rim-near', 0.4)}
              <linearGradient id="drive-hill-far" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#2a1553" />
                <stop offset="1" stopColor="#170c34" />
              </linearGradient>
              <linearGradient id="drive-hill-near" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#1a0e3a" />
                <stop offset="1" stopColor="#100828" />
              </linearGradient>
              <linearGradient id="drive-city" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#150c33" />
                <stop offset="1" stopColor="#0b0720" />
              </linearGradient>
            </defs>
            <path className="drive-hills-far" d={scene.far} fill="url(#drive-hill-far)" />
            <path className="drive-rim" d={scene.farRim} stroke="url(#drive-rim-far)" />
            <path className="drive-hills-near" d={scene.near} fill="url(#drive-hill-near)" />
            <path className="drive-rim is-near" d={scene.nearRim} stroke="url(#drive-rim-near)" />
            <path className="drive-city" d={scene.city.body} fill="url(#drive-city)" />
            <path className="drive-palms" d={scene.palms} />
            <g className="drive-windows">
              {scene.city.windows.map((w, i) => (
                <rect key={i} x={f1(w.x)} y={f1(w.y)} width="1.3" height="1.3" opacity={w.o.toFixed(2)} />
              ))}
            </g>
            {scene.city.beacon && (
              <circle className="drive-beacon" cx={f1(scene.city.beacon.x)} cy={f1(scene.city.beacon.y)} r="1.3" />
            )}
          </>
        )}
      </svg>
    </>
  );
}
