import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { livePosition, useSonos } from '../store/useSonos';
import { hashString } from '../lib/hash';
import { mmss } from '../lib/format';

/** Bar width and the smallest gap; the row justifies, so gaps only ever grow. */
const BAR = 2;
const GAP = 2;
/** The waveform is drawn once at this resolution and re-sampled for however many bars fit. */
const SAMPLES = 256;
const MIN_BARS = 24;
const MAX_BARS = 160;
/** Live bars sit low and breathe; the CSS scales them up from here. */
const LIVE_SCALE = 0.36;

/**
 * The interpolated needle at ~10fps, resynced whenever a fresh snapshot lands —
 * the same clock Progress keeps.
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

/** mulberry32: a small deterministic generator, [0, 1). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The song's shape, seeded by its title: a smooth envelope (a window that
 * swells toward the middle, crossed with two slow sines) carrying finer
 * detail (value noise, blurred once so neighbours relate) and the odd
 * transient poking above it. Normalised so the tallest bar fills the row.
 */
function shape(seed: string): Float32Array {
  const next = rng(hashString(seed) || 1);
  const f1 = 1.2 + next() * 1.6;
  const f2 = 3.5 + next() * 3.5;
  const p1 = next();
  const p2 = next();
  const swell = 0.35 + next() * 0.4;

  const raw = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) raw[i] = next();

  const out = new Float32Array(SAMPLES);
  let peak = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t = (i + 0.5) / SAMPLES;
    const window = 1 - swell + swell * Math.sin(Math.PI * t) ** 0.8;
    const slow = 0.5 + 0.5 * Math.sin(2 * Math.PI * (f1 * t + p1));
    const mid = 0.5 + 0.5 * Math.sin(2 * Math.PI * (f2 * t + p2));
    const envelope = window * (0.45 + 0.35 * slow + 0.2 * mid);
    const noise = (raw[(i + SAMPLES - 1) % SAMPLES] + 2 * raw[i] + raw[(i + 1) % SAMPLES]) / 4;
    const detail = 0.5 + 0.5 * noise;
    const transient = raw[i] > 0.93 ? 1.25 : 1;
    const v = envelope * detail * transient;
    out[i] = v;
    if (v > peak) peak = v;
  }
  for (let i = 0; i < SAMPLES; i++) out[i] = Math.max(0.08, out[i] / peak);
  return out;
}

/**
 * Progress as a waveform: thin rounded bars, played ones in ink, the rest in
 * light grey, the boundary between them the playhead. Click or drag anywhere
 * to seek. Radio has no timeline, so the bars breathe near a baseline instead.
 */
export default function DaylightWave() {
  const state = useSonos((s) => s.state);
  const receivedAt = useSonos((s) => s.receivedAt);
  const seekTo = useSonos((s) => s.seekTo);
  const trackRef = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState(96);
  const [scrub, setScrub] = useState<number | null>(null);
  const live = useLivePosition(receivedAt);

  const ready = !!state;
  const radio = !!state?.isRadio;
  const seed = radio ? (state?.stationName ?? 'live') : (state?.track?.title ?? '');
  const heights = useMemo(() => shape(seed), [seed]);

  const duration = state?.durationSecs ?? 0;
  const position = scrub ?? live;

  // How many bars fit the row at the minimum gap.
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const fit = (w: number) =>
      setBars(Math.max(MIN_BARS, Math.min(MAX_BARS, Math.floor((w + GAP) / (BAR + GAP)))));
    fit(el.clientWidth);
    const ro = new ResizeObserver((entries) => fit(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

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

  const pct = !radio && duration > 0 ? Math.max(0, Math.min(1, position / duration)) * 100 : 0;
  // No timeline at all (nothing on): a flat baseline, not a made-up song.
  const scale = radio ? LIVE_SCALE : duration > 0 ? 1 : 0;
  const row = Array.from({ length: bars }, (_, i) => {
    const h = heights[Math.floor(((i + 0.5) / bars) * SAMPLES)] * scale;
    const style = { height: `max(3px, ${(h * 100).toFixed(1)}%)`, '--i': i } as React.CSSProperties;
    return <i key={i} style={style} />;
  });

  if (radio) {
    return (
      <div className="dl-wave is-live">
        <div className="dl-wave-track" ref={trackRef}>
          <div className="dl-wave-layer" aria-hidden="true">
            {row}
          </div>
        </div>
        <div className="dl-wave-times">
          <span className="dl-live">
            <i aria-hidden="true" />
            Live
          </span>
          <span className="num">{mmss(live)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`dl-wave${scrub !== null ? ' is-scrubbing' : ''}`}>
      <div
        className="dl-wave-track"
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
        <div className="dl-wave-layer dl-wave-rest" aria-hidden="true">
          {row}
        </div>
        <div
          className="dl-wave-layer dl-wave-played"
          style={{ clipPath: `inset(0 ${(100 - pct).toFixed(2)}% 0 0)` }}
          aria-hidden="true"
        >
          {row}
        </div>
      </div>
      <div className="dl-wave-times">
        <span className="num">{mmss(position)}</span>
        <span className="num">{mmss(duration)}</span>
      </div>
    </div>
  );
}
