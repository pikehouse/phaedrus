import { useState } from 'react';
import { useSonos } from '../store/useSonos';
import Progress from './Progress';
import Transport from './Transport';
import TunerVFD, { type Display } from './TunerVFD';
import '../styles/tuner.css';

const KEY = 'phaedrus.tuner.display';
const ORDER: Display[] = ['text', 'spectrum', 'image'];
const FACE: Record<Display, string> = { text: 'DIAL', spectrum: 'SPEC', image: 'IMAGE' };

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

      <i className="tuner-seam" aria-hidden="true" />

      <div className="tuner-lower">
        {/* Station presets, wired to the first six of the queue — the row of
            numbered keys every tuner had, doing the only thing it could here. */}
        <div className="tuner-presets">
          <span className="tuner-presets-cap">Memory</span>
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
        </div>

        <SubDisplay name={queue.find((q) => q.index === current)?.title} />
      </div>

      <i className="tuner-vents" aria-hidden="true" />
    </div>
  );
}

/**
 * The second, smaller window every separate had under the main one: a signal
 * meter (here, how hard the group is being driven) and the preset's name.
 */
function SubDisplay({ name }: { name?: string }) {
  const state = useSonos((s) => s.state);
  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';
  const volume = Math.max(0, Math.min(100, state?.volume ?? 0));
  const muted = !!state?.muted;
  const lit = Math.round((volume / 100) * 20);
  const members = state?.members.length ?? 0;
  const shown = state?.isRadio ? state.stationName ?? state.track?.title : name;

  return (
    <div className="tsub" role="img" aria-label={`Signal ${volume}${muted ? ', muted' : ''}`}>
      <div className="tsub-glass">
        <div className="tsub-meter">
          <span className="tsub-cap">Signal</span>
          <span className="tsub-bars">
            {Array.from({ length: 20 }, (_, i) => (
              <i
                key={i}
                className={i < lit ? (muted ? 'is-on is-muted' : i >= 16 ? 'is-on is-peak' : 'is-on') : undefined}
              />
            ))}
          </span>
          <span className="tsub-scale">
            {['1', '2', '3', '4', '5'].map((n) => (
              <b key={n}>{n}</b>
            ))}
          </span>
        </div>
        <div className="tsub-info">
          <span className="tsub-name">{(shown ?? '').toUpperCase() || '— — —'}</span>
          <span className="tsub-lamps">
            <span className={`tsub-lamp${playing ? ' is-on' : ''}`}>ST</span>
            <span className={`tsub-lamp${!playing && !!state?.track ? ' is-on' : ''}`}>MONO</span>
            <span className={`tsub-lamp is-amber${members > 1 ? ' is-on' : ''}`}>LINK {members || '-'}</span>
            <span className={`tsub-lamp is-red${muted ? ' is-on' : ''}`}>MUTING</span>
          </span>
        </div>
      </div>
    </div>
  );
}
