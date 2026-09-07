import { useState } from 'react';
import { useSonos } from '../store/useSonos';
import Progress from './Progress';
import Transport from './Transport';
import TunerVFD, { type Display } from './TunerVFD';
import '../styles/tuner.css';

const KEY = 'phaedrus.tuner.display';
const ORDER: Display[] = ['text', 'spectrum', 'image'];
const FACE: Record<Display, string> = { text: 'TEXT', spectrum: 'SPEC', image: 'IMAGE' };

function recall(): Display {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'text' || v === 'spectrum' || v === 'image') return v;
  } catch {
    /* private mode — the mode just won't survive a restart */
  }
  return 'text';
}

/**
 * The front panel of a 1988 separate: brushed black aluminium, four machine
 * screws, a model badge, a wide VFD behind smoked glass, and a row of
 * soft-touch keys. The volume knob and room faders live on the faceplate
 * below, which NowPlaying keeps for every skin.
 *
 * Transport and Progress are the app's own components — the skin restyles
 * them, and the silkscreen under each key is drawn by CSS, so none of the
 * store logic is forked to get a different shape of button.
 */
export default function TunerStage() {
  const group = useSonos((s) => s.group);
  const queue = useSonos((s) => s.queue);
  const current = useSonos((s) => s.state?.queueIndex);
  const playQueueIndex = useSonos((s) => s.playQueueIndex);
  const [mode, setMode] = useState<Display>(recall);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* nothing to do; the panel still works */
    }
  };

  return (
    <div className="tuner-face">
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <i key={c} className={`tuner-screw is-${c}`} aria-hidden="true" />
      ))}

      <header className="tuner-head">
        <span className="tuner-badge">
          <span className="tuner-brand">PHÆDRUS</span>
          <span className="tuner-model">ST-S707ES</span>
          <span className="tuner-legend">Digital Synthesizer Tuner · Quartz Lock</span>
        </span>

        {/* A power switch on a controller would be a lie — this one is trim. */}
        <span className="tkey tkey-power" aria-hidden="true">
          <i className={`tuner-led${group ? ' is-lit' : ''}`} />
        </span>
      </header>

      <i className="tuner-seam" aria-hidden="true" />

      <TunerVFD mode={mode} />

      <i className="tuner-seam" aria-hidden="true" />

      <div className="tuner-controls">
        <Transport />

        <button
          type="button"
          className="tkey tkey-display"
          onClick={cycle}
          aria-label={`Display mode ${FACE[mode]} — press to change`}
        >
          <span className="tkey-face">{FACE[mode]}</span>
        </button>

        <div className="tuner-progress">
          <Progress />
        </div>
      </div>

      {/* Station presets, wired to the first six of the queue — the row of
          numbered keys every tuner had, doing the only thing it could here. */}
      <div className="tuner-presets">
        <span className="tuner-presets-cap">Preset</span>
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const item = queue.find((q) => q.index === n);
          return (
            <button
              key={n}
              type="button"
              className={`tkey tkey-preset${current === n ? ' is-on' : ''}`}
              disabled={!item}
              onClick={() => void playQueueIndex(n)}
              aria-label={item ? `Preset ${n} — ${item.title}` : `Preset ${n}, empty`}
              aria-pressed={current === n}
            >
              <span className="tkey-face">{n}</span>
            </button>
          );
        })}
        <span className="tuner-presets-name">
          {queue.find((q) => q.index === current)?.title ?? ''}
        </span>
      </div>

      <i className="tuner-vents" aria-hidden="true" />
    </div>
  );
}
