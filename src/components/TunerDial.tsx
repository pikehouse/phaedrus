import { useMemo } from 'react';
import { hashString } from '../lib/hash';
import TunerSegment14 from './TunerSegment14';
import '../styles/tuner.css';

/* ══════════════════════════════════════════════════════════════════════════
   THE TUNING SCALE

   The thing every tuner of the period was built around: a long printed
   frequency scale with a cursor riding it. FM on top, AM underneath at a
   lower brightness, both read against one cursor — here, the track's
   progress. The cursor is placed with a transform on a full-width carriage
   and eased by a one-second linear transition, so a 1Hz position update
   reads as a continuous slow slide with no animation loop of its own. A
   stream has no progress; the cursor parks on a frequency derived from the
   station's name and the TUNED / STEREO lamps light.
   ══════════════════════════════════════════════════════════════════════════ */

const FM_LO = 87.5;
const FM_HI = 108.5;
const AM_LO = 520;
const AM_HI = 1620;

const fmX = (f: number) => (f - FM_LO) / (FM_HI - FM_LO);
const amX = (k: number) => (k - AM_LO) / (AM_HI - AM_LO);

interface Tick {
  x: number;
  kind: 'major' | 'mid' | 'minor';
  label?: string;
}

/** FM: a tick every 0.5 MHz, a longer one each MHz, a numbered one every 2. */
const FM_TICKS: Tick[] = Array.from({ length: 43 }, (_, i) => {
  const f = FM_LO + i * 0.5;
  const whole = Number.isInteger(f);
  const major = whole && f % 2 === 0;
  return {
    x: fmX(f),
    kind: major ? 'major' : whole ? 'mid' : 'minor',
    label: major ? String(f) : undefined,
  };
});

const AM_LABELS = new Set([530, 600, 700, 800, 1000, 1200, 1400, 1600]);
/** AM: 530, then every 50 kHz; the period's own irregular numbering. */
const AM_TICKS: Tick[] = [530, ...Array.from({ length: 22 }, (_, i) => 550 + i * 50)].map((k) => ({
  x: amX(k),
  kind: AM_LABELS.has(k) ? 'major' : k % 100 === 0 ? 'mid' : 'minor',
  label: AM_LABELS.has(k) ? String(k) : undefined,
}));

/** US FM channel for a station: 88.1–107.9 in 0.2 MHz steps, fixed by name. */
function stationFrequency(name: string): number {
  return 88.1 + (hashString(name) % 100) * 0.2;
}

interface Props {
  /** 0–1 along the scale, or null when there is nothing to show. */
  progress: number | null;
  radio: boolean;
  station?: string;
  playing: boolean;
  loaded: boolean;
  /** Whether the carriage glides between updates (off for reduced motion). */
  glide: boolean;
}

export default function TunerDial({ progress, radio, station, playing, loaded, glide }: Props) {
  const parked = useMemo(() => (station ? stationFrequency(station) : 98.1), [station]);
  const p = radio ? fmX(parked) : Math.max(0, Math.min(1, progress ?? 0));
  const freq = radio ? parked : FM_LO + p * (FM_HI - FM_LO);
  // Nearest numbered mark lights hot, like the lamp behind a printed figure.
  const hotFm = Math.round(freq / 2) * 2;
  const lit = loaded && (radio || progress != null);

  return (
    <div
      className={`tdial${radio ? ' is-radio' : ''}${lit ? ' is-lit' : ''}${glide ? ' is-glide' : ''}`}
      style={{ '--p': p } as React.CSSProperties}
      aria-hidden="true"
    >
      <div className="tdial-head">
        <span className="tdial-mode">
          <span className="tdial-tag is-on">FM</span>
          <span className="tdial-tag">AM</span>
          <span className="tdial-rule" />
          <span className={`tdial-tag${radio && loaded ? ' is-on' : ''}`}>TUNED</span>
          <span className={`tdial-tag${radio && playing ? ' is-on' : ''}`}>STEREO</span>
          <span className={`tdial-tag is-amber${!radio && loaded ? ' is-on' : ''}`}>AUTO</span>
        </span>
        <span className="tdial-readout">
          <TunerSegment14 className="tdial-freq" text={lit ? freq.toFixed(1).padStart(5, ' ') : '---.-'} />
          <span className="tdial-unit">MHz</span>
        </span>
      </div>

      <div className="tdial-scale">
        <span className="tdial-band is-fm">FM</span>
        <div className="tdial-track is-fm">
          {FM_TICKS.map((t, i) => (
            <span
              key={i}
              className={`tdial-tick is-${t.kind}${lit && !radio && t.x <= p ? ' is-past' : ''}`}
              style={{ left: `${t.x * 100}%` }}
            >
              {t.label && (
                <b className={lit && Number(t.label) === hotFm ? 'is-hot' : undefined}>{t.label}</b>
              )}
            </span>
          ))}
        </div>
        <span className="tdial-unit-end is-fm">MHz</span>

        <span className="tdial-band is-am">AM</span>
        <div className="tdial-track is-am">
          {AM_TICKS.map((t, i) => (
            <span key={i} className={`tdial-tick is-${t.kind}`} style={{ left: `${t.x * 100}%` }}>
              {t.label && <b>{t.label}</b>}
            </span>
          ))}
        </div>
        <span className="tdial-unit-end is-am">kHz</span>

        <div className="tdial-rail">
          <div className="tdial-carriage">
            <i className="tdial-needle" />
          </div>
        </div>
      </div>
    </div>
  );
}
