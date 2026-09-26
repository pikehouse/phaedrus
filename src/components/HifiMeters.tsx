import { useEffect, useMemo, useRef } from 'react';
import { useSonos } from '../store/useSonos';
import { mulberry, trackSeed } from './DeckSignal';
import { useReducedMotion } from '../hooks/useReducedMotion';

/* ══════════════════════════════════════════════════════════════════════════
   VU METERS

   A pair of backlit moving-coil meters on the amplifier's faceplate. There is
   no audio to meter, so the signal is synthesised the way DeckSignal and
   TunerSpectrum do it — seeded from the track so a record always moves the
   needles the same way — scaled by the group volume and silent when muted.

   The needles are not eased, they are *driven*: a spring-damper (a real
   meter movement is one) chases the signal, so a note swings them up with a
   touch of overshoot and a pause lets them trickle back to the stop pin.

   One rAF loop writes each needle's rotation straight onto the SVG; React
   renders the faces once. The loop parks when the needles have settled with
   nothing playing, when the tab is hidden, when the meters are not laid out
   (narrow stages and phones hide them), and under reduced motion.
   ══════════════════════════════════════════════════════════════════════════ */

// Face geometry, in the SVG's 120 × 76 viewBox. The pivot sits below the face,
// under the hood, as it does in a real meter.
const CX = 60;
const CY = 94;
const R = 66; // the scale arc
const SWEEP = 45; // degrees either side of vertical
const FULL = 1.4125; // +3 VU, the right-hand end of the scale, as amplitude

/** Amplitude (1 = 0 VU) → fraction of the sweep. A VU scale is linear in volts. */
const posOf = (amp: number) => amp / FULL;
const posDb = (db: number) => posOf(Math.pow(10, db / 20));
const angleOf = (pos: number) => -SWEEP + 2 * SWEEP * pos;

function pt(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(a), CY - r * Math.cos(a)];
}

function arc(r: number, from: number, to: number): string {
  const [x1, y1] = pt(r, from);
  const [x2, y2] = pt(r, to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function tick(r1: number, r2: number, deg: number): string {
  const [x1, y1] = pt(r1, deg);
  const [x2, y2] = pt(r2, deg);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

const DB_MAJOR = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
const DB_MINOR = [-15, -6, -4, -0.5, 0.5, 1.5, 2.5];
const PCT = [0, 20, 40, 60, 80, 100];

// ── Ballistics ────────────────────────────────────────────────────────────
const OMEGA = 2 * Math.PI * 1.1; // natural frequency — a heavy, unhurried movement
const ZETA = 0.74; // damping ratio: a whisker of overshoot, no wobble
const REST = 0; // the stop pin, as a fraction of the sweep
const PIN = 1.07; // the right-hand stop
const ATTACK_S = 0.8; // silence → programme level when play starts
const RELEASE_S = 1.8; // programme → silence: the slow trickle back
const PEAK_AT = 1.16; // ≈ +1.3 VU lights the peak lamp

interface Props {
  playing: boolean;
}

export default function HifiMeters({ playing }: Props) {
  const title = useSonos((s) => (s.state?.isRadio ? s.state.stationName : s.state?.track?.title));
  const artist = useSonos((s) => s.state?.track?.artist);
  const volume = useSonos((s) => s.state?.volume ?? 0);
  const muted = useSonos((s) => !!s.state?.muted);
  const seed = trackSeed(title, artist);
  const reduced = useReducedMotion();

  const rootRef = useRef<HTMLDivElement>(null);
  const play = useRef(playing);
  const gain = useRef(0);
  const wake = useRef<(() => void) | null>(null);

  // Volume is read by the loop, never rebuilt into it: a knob turn changes the
  // level of a running meter, it does not restart the tune.
  useEffect(() => {
    gain.current = muted || volume <= 0 ? 0 : 0.3 + 0.7 * Math.sqrt(volume / 100);
    wake.current?.();
  }, [volume, muted]);

  useEffect(() => {
    play.current = playing;
    wake.current?.();
  }, [playing]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const needles = [...root.querySelectorAll<SVGGElement>('.hifi-vu-needle')];
    const lamps = [...root.querySelectorAll<SVGElement>('.hifi-vu-peak-lit')];
    const n = needles.length;

    const rnd = mulberry(seed);
    // Programme: shared by both channels — it is one record.
    const beat = 60 / (78 + Math.floor(rnd() * 44));
    const swellW = 0.11 + rnd() * 0.14;
    const swellP = rnd() * Math.PI * 2;
    const phraseW = 0.5 + rnd() * 0.4;
    const voice = Array.from({ length: n }, () => ({
      w1: 1.1 + rnd() * 0.9,
      w2: 2.6 + rnd() * 1.5,
      p1: rnd() * Math.PI * 2,
      p2: rnd() * Math.PI * 2,
      lean: 0.94 + rnd() * 0.1, // one side of the mix always sits a touch hotter
    }));

    const x = new Float32Array(n); // needle position, fraction of the sweep
    const v = new Float32Array(n);
    const noise = new Float32Array(n);
    const peak = new Float32Array(n);
    const shown = new Float32Array(n).fill(NaN);
    const lampShown = new Float32Array(n).fill(NaN);
    let level = play.current ? 1 : 0; // programme fade in/out
    let t = rnd() * 40;
    let raf = 0;
    let last = 0;

    const paint = () => {
      for (let c = 0; c < n; c++) {
        const a = Math.round(angleOf(x[c]) * 100) / 100;
        if (a !== shown[c]) {
          needles[c].setAttribute('transform', `rotate(${a} ${CX} ${CY})`);
          shown[c] = a;
        }
        const l = Math.round(peak[c] * 50) / 50;
        if (lamps[c] && l !== lampShown[c]) {
          lamps[c].style.opacity = String(l);
          lampShown[c] = l;
        }
      }
    };

    const signal = (c: number): number => {
      const vc = voice[c];
      noise[c] = noise[c] * 0.96 + (Math.random() - 0.5) * 0.09;
      const swell = 0.8 + 0.2 * Math.sin(t * swellW * Math.PI * 2 + swellP);
      const phrase = 0.86 + 0.14 * Math.sin(t * phraseW + vc.p2 * 0.3);
      const tone =
        0.62 + Math.sin(t * vc.w1 + vc.p1) * 0.12 + Math.sin(t * vc.w2 + vc.p2) * 0.07 + noise[c] * 0.6;
      const kick = Math.exp(-((t % beat) / beat) * 5) * 0.22;
      const amp = (tone * swell * phrase * 1.45 + kick) * vc.lean * gain.current * level;
      return Math.max(0, amp);
    };

    const advance = (dt: number) => {
      t += dt;
      level = play.current ? Math.min(1, level + dt / ATTACK_S) : Math.max(0, level - dt / RELEASE_S);
      for (let c = 0; c < n; c++) {
        const target = Math.min(PIN + 0.1, posOf(signal(c)));
        // Semi-implicit Euler in two half-steps: stable at any frame rate we allow.
        for (let k = 0; k < 2; k++) {
          const h = dt / 2;
          const acc = OMEGA * OMEGA * (target - x[c]) - 2 * ZETA * OMEGA * v[c];
          v[c] += acc * h;
          x[c] += v[c] * h;
        }
        if (x[c] < REST) {
          x[c] = REST;
          v[c] = Math.abs(v[c]) * 0.12; // a soft knock against the pin
        } else if (x[c] > PIN) {
          x[c] = PIN;
          v[c] = -Math.abs(v[c]) * 0.12;
        }
        // Peak lamp: lights fast, fades like a filament.
        const hot = posOf(PEAK_AT) <= x[c] ? 1 : 0;
        peak[c] = hot ? Math.min(1, peak[c] + dt * 6) : Math.max(0, peak[c] - dt * 1.4);
      }
    };

    const settled = () => {
      if (play.current || level > 0) return false;
      for (let c = 0; c < n; c++) {
        if (x[c] > 0.0005 || Math.abs(v[c]) > 0.0005 || peak[c] > 0) return false;
      }
      return true;
    };

    const visible = () => !document.hidden && root.offsetWidth > 0;

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
      const dt = Math.min(1 / 30, (ts - last) / 1000);
      last = ts;
      advance(dt);
      paint();
      if (settled() || !visible()) {
        if (settled()) {
          x.fill(REST);
          v.fill(0);
          paint();
        }
        stop();
      }
    };

    const nudge = () => {
      if (raf || !visible()) return;
      raf = requestAnimationFrame(step);
    };

    if (reduced) {
      // Still needles: where the programme would sit on average, or at rest.
      const still = () => {
        for (let c = 0; c < n; c++) {
          x[c] = play.current ? Math.min(PIN, posOf(0.72 * voice[c].lean * gain.current)) : REST;
        }
        peak.fill(0);
        paint();
      };
      wake.current = still;
      still();
      return () => {
        wake.current = null;
      };
    }

    paint();
    wake.current = nudge;
    const onVisibility = () => (document.hidden ? stop() : nudge());
    document.addEventListener('visibilitychange', onVisibility);
    // Shown again after a narrow window hid it: pick the needles back up.
    const ro = new ResizeObserver(() => nudge());
    ro.observe(root);
    nudge();

    return () => {
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      wake.current = null;
    };
  }, [seed, reduced]);

  return (
    <div className={`hifi-meters${playing ? ' is-live' : ''}`} ref={rootRef} aria-hidden="true">
      <Meter channel="L" />
      <Meter channel="R" />
    </div>
  );
}

function Meter({ channel }: { channel: 'L' | 'R' }) {
  const face = useMemo(() => {
    const zero = angleOf(posDb(0));
    const lo = angleOf(posDb(-20));
    const hi = angleOf(posDb(3));
    const major = DB_MAJOR.map((db) => tick(R, R + (db === 0 ? 7.5 : 6), angleOf(posDb(db))));
    const minor = DB_MINOR.map((db) => tick(R, R + 3.4, angleOf(posDb(db))));
    const pct = PCT.map((p) => tick(R - 7, R - 3.6, angleOf(posOf(p / 100))));
    const labels = DB_MAJOR.map((db) => {
      const [lx, ly] = pt(R + 11, angleOf(posDb(db)));
      return { db, x: lx, y: ly + 2.3, text: db > 0 ? `+${db}` : String(Math.abs(db)) };
    });
    const pctLabels = [0, 50, 100].map((p) => {
      const [lx, ly] = pt(R - 13, angleOf(posOf(p / 100)));
      return { p, x: lx, y: ly + 1.8 };
    });
    return {
      black: arc(R, lo, zero),
      red: arc(R + 1.8, zero, hi),
      redHair: arc(R, zero, hi),
      inner: arc(R - 7, angleOf(0), angleOf(posOf(1))),
      major: major.join(''),
      majorRed: DB_MAJOR.filter((db) => db > 0)
        .map((db) => tick(R, R + 6, angleOf(posDb(db))))
        .join(''),
      minor: minor.join(''),
      pct: pct.join(''),
      labels,
      pctLabels,
    };
  }, []);

  return (
    <div className="hifi-vu">
      <div className="hifi-vu-window">
        <svg className="hifi-vu-face" viewBox="0 0 120 76" preserveAspectRatio="xMidYMid meet">
          <path className="hifi-vu-scale-inner" d={face.inner} />
          <path className="hifi-vu-scale-pct" d={face.pct} />
          {face.pctLabels.map((l) => (
            <text key={l.p} className="hifi-vu-pct" x={l.x} y={l.y} textAnchor="middle">
              {l.p}
            </text>
          ))}
          <path className="hifi-vu-scale" d={face.black} />
          <path className="hifi-vu-redzone" d={face.red} />
          <path className="hifi-vu-scale is-red" d={face.redHair} />
          <path className="hifi-vu-ticks" d={face.major} />
          <path className="hifi-vu-ticks is-minor" d={face.minor} />
          <path className="hifi-vu-ticks is-red" d={face.majorRed} />
          {face.labels.map((l) => (
            <text
              key={l.db}
              className={`hifi-vu-num${l.db > 0 ? ' is-red' : ''}`}
              x={l.x}
              y={l.y}
              textAnchor="middle"
            >
              {l.text}
            </text>
          ))}
          <text className="hifi-vu-legend" x={CX} y={57} textAnchor="middle">
            VU
          </text>
          <text className="hifi-vu-ch" x={7.5} y={66.5}>
            {channel}
          </text>

          <circle className="hifi-vu-peak" cx={108} cy={61} r={2.1} />
          <circle className="hifi-vu-peak-lit" cx={108} cy={61} r={2.1} style={{ opacity: 0 }} />

          {/* Needle: a shadow thrown on the face, then the blade itself. */}
          <g className="hifi-vu-needle" transform={`rotate(${-SWEEP} ${CX} ${CY})`}>
            <line className="hifi-vu-needle-shadow" x1={CX + 1.3} y1={CY - 18} x2={CX + 1.3} y2={CY - 73} />
            <line className="hifi-vu-needle-blade" x1={CX} y1={CY - 18} x2={CX} y2={CY - 75} />
          </g>

          <path className="hifi-vu-hood" d="M0 76V69.5Q60 57 120 69.5V76Z" />
          <path className="hifi-vu-hood-lip" d="M0 69.5Q60 57 120 69.5" />
        </svg>
        <i className="hifi-vu-glass" />
      </div>
    </div>
  );
}
