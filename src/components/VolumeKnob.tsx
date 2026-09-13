import { useRef, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { clampVol } from '../lib/format';
import '../styles/knob.css';

const SWEEP = 270; // degrees of usable travel, centred on 12 o'clock
const START = -135;
const angleFor = (v: number) => START + (clampVol(v) / 100) * SWEEP;

/** Arc ticks: long every 20, short every 5. */
const TICKS = Array.from({ length: 21 }, (_, i) => i * 5);

export default function VolumeKnob() {
  const state = useSonos((s) => s.state);
  const setGroupVolume = useSonos((s) => s.setGroupVolume);
  const [dragging, setDragging] = useState(false);
  const origin = useRef({ x: 0, y: 0, v: 0 });
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  if (!state) return null;
  const volume = state.volume;

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY, v: volume };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    // Up and right both raise it; a diagonal drag agrees with itself.
    const dy = origin.current.y - e.clientY;
    const dx = e.clientX - origin.current.x;
    const next = origin.current.v + (dy + dx) * 0.38;
    void setGroupVolume(next);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    const dy = origin.current.y - e.clientY;
    const dx = e.clientX - origin.current.x;
    void setGroupVolume(origin.current.v + (dy + dx) * 0.38, true);
  };

  const onWheel = (e: React.WheelEvent) => {
    const step = e.deltaY < 0 ? 2 : -2;
    // Several wheel events can land in one frame; build on the store, not the last render.
    void setGroupVolume((useSonos.getState().state?.volume ?? volume) + step);
    clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => {
      void setGroupVolume(useSonos.getState().state?.volume ?? volume, true);
    }, 180);
  };

  return (
    <div className="knob-block">
      <span className="label knob-caption">Volume</span>

      <div
        className={`knob${dragging ? ' is-dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') void setGroupVolume(volume + 2, true);
          if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') void setGroupVolume(volume - 2, true);
        }}
        role="slider"
        tabIndex={0}
        aria-label="Group volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volume}
      >
        <svg className="knob-scale" viewBox="0 0 120 120" aria-hidden="true">
          {TICKS.map((t) => {
            const a = ((angleFor(t) - 90) * Math.PI) / 180;
            const major = t % 20 === 0;
            const r1 = major ? 47 : 50;
            const lit = t <= volume;
            return (
              <line
                key={t}
                x1={60 + Math.cos(a) * r1}
                y1={60 + Math.sin(a) * r1}
                x2={60 + Math.cos(a) * 55}
                y2={60 + Math.sin(a) * 55}
                className={`knob-tick${major ? ' is-major' : ''}${lit ? ' is-lit' : ''}`}
              />
            );
          })}
        </svg>

        <div className="knob-body">
          <div className="knob-face" style={{ transform: `rotate(${angleFor(volume)}deg)` }}>
            <span className="knob-pointer" />
          </div>
          <span className="num knob-value">{volume}</span>
        </div>
      </div>
    </div>
  );
}
