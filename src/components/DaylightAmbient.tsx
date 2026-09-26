import { useEffect, useRef, useState } from 'react';

/**
 * Daylight's colour: the cover, breathed onto the page.
 *
 * Two parts. The wash is a heavily blurred, scaled-up copy of the art behind
 * the whole stage at a low opacity — a plain <img> with a CSS filter, so it
 * works whatever the art server's CORS headers say. The tint is one colour
 * sampled from the art on a canvas (when CORS allows), tempered to a mid tone
 * and published as `--dl-tint` on the root, where the cover's shadow, the
 * waveform and the queue's current row pick it up. Both crossfade over ~1s.
 */

const NEUTRAL = 'rgb(17, 19, 24)';

type Layer = { key: number; art: string | null; ready: boolean };

/** The blurred cover behind the stage. Each new cover fades in over the last. */
export function DaylightWash({ art }: { art?: string | null }) {
  const next = useRef(0);
  const [layers, setLayers] = useState<Layer[]>(() =>
    art ? [{ key: next.current++, art, ready: false }] : [],
  );

  // A new cover (or none) becomes the top layer; the ones beneath stay until it has faded in.
  const current = art ?? null;
  const top = layers[layers.length - 1];
  if ((top?.art ?? null) !== current && !(layers.length === 0 && current === null)) {
    setLayers((ls) => [...ls.slice(-2), { key: next.current++, art: current, ready: current === null }]);
  }

  const readyKey = top?.ready ? top.key : null;
  useEffect(() => {
    if (readyKey === null) return;
    const t = setTimeout(() => {
      setLayers((ls) => {
        const i = ls.findIndex((l) => l.key === readyKey);
        if (i <= 0) return ls;
        const rest = ls.slice(i);
        return rest.length === 1 && rest[0].art === null ? [] : rest;
      });
    }, 1150);
    return () => clearTimeout(t);
  }, [readyKey]);

  const markReady = (key: number) =>
    setLayers((ls) => ls.map((l) => (l.key === key ? { ...l, ready: true } : l)));

  return (
    <div className="dl-wash" aria-hidden="true">
      {layers.map((l, i) => {
        const last = i === layers.length - 1;
        const leaving = !last && !!top?.ready;
        return (
          <div
            key={l.key}
            className={`dl-wash-layer${l.ready && !leaving ? ' is-in' : ''}${leaving ? ' is-leaving' : ''}`}
          >
            {l.art && (
              <img
                src={l.art}
                alt=""
                draggable={false}
                onLoad={() => markReady(l.key)}
                onError={() => markReady(l.key)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── The tint ─────────────────────────────────────────────────────────── */

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/**
 * One colour for a cover: the average of its more colourful pixels (so a
 * red jacket on a grey wall reads red, not grey), then tempered to a mid tone
 * that tints a light page without shouting. Null when CORS taints the canvas.
 */
function sampleTint(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      const timer = setTimeout(() => done(null), 4000);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const n = 32;
          const canvas = document.createElement('canvas');
          canvas.width = n;
          canvas.height = n;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return done(null);
          ctx.drawImage(img, 0, 0, n, n);
          const { data } = ctx.getImageData(0, 0, n, n);
          let r = 0;
          let g = 0;
          let b = 0;
          let w = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 24) continue;
            const [, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
            // Weight by colourfulness; near-white and near-black count for little.
            const k = 0.08 + s * s * (1 - Math.abs(l - 0.5) * 1.6);
            r += data[i] * k;
            g += data[i + 1] * k;
            b += data[i + 2] * k;
            w += k;
          }
          if (!w) return done(null);
          const [h, s, l] = rgbToHsl(r / w, g / w, b / w);
          const [R, G, B] = hslToRgb(h, Math.min(0.62, s * 1.25), Math.min(0.56, Math.max(0.38, l)));
          done(`rgb(${Math.round(R)}, ${Math.round(G)}, ${Math.round(B)})`);
        } catch {
          done(null); // tainted canvas
        }
      };
      img.onerror = () => {
        clearTimeout(timer);
        done(null);
      };
      img.src = url;
    } catch {
      done(null);
    }
  });
}

/**
 * Publishes `--dl-tint` (the cover's tempered colour, ink when there is none)
 * and `--dl-vol` (the group volume, for the ring slider drawn around the
 * shared knob) on the root while Daylight is on screen.
 */
export function useDaylightRootVars(art: string | undefined, volume: number | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    let live = true;
    if (!art) {
      root.style.setProperty('--dl-tint', NEUTRAL);
      return;
    }
    void sampleTint(art).then((c) => {
      if (live) root.style.setProperty('--dl-tint', c ?? NEUTRAL);
    });
    return () => {
      live = false;
    };
  }, [art]);

  useEffect(() => {
    document.documentElement.style.setProperty('--dl-vol', String(Math.max(0, Math.min(100, volume ?? 0))));
  }, [volume]);

  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--dl-tint');
      document.documentElement.style.removeProperty('--dl-vol');
    },
    [],
  );
}
