import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { Bold, Small, fit, measure } from '../lib/pocketFont';
import { BLACK, CLEAR, Pix, WHITE, knob, paint, pointer, speaker, wavesFor } from '../lib/pocketPix';
import type { MemberVolume } from '../api/types';

/* ══════════════════════════════════════════════════════════════════════════
   POCKET PANEL — the volume, as a control panel from an old desktop

   Under the player, in place of the knob and faders the other skins use: a
   little one-bit window, black on white, a one-pixel frame and a hard shadow,
   a pinstriped title bar with a close box and "Sound" knocked out of it,
   a grow box in the corner.

     left    the group's volume: a speaker whose waves grow with it, the
             number, and a slider notched 0–7 like the old Sound panel's
             (the notches are decoration; the slider runs 0–100)
     right   a row per room: a speaker that mutes it (crossed out when
             muted, inverted while pressed), the name, a slider with tick
             marks and the pointer-shaped thumb of the old mouse panels,
             and the number

   Every label, name and number is the LCD's own bitmap face, drawn into a
   canvas at a whole-number scale. The store calls, keys and labels are the
   same as VolumeKnob's and Faders': setGroupVolume / setMemberVolume while
   dragging and again with `final` on release, setMemberMute, arrows ±2.
   Nothing here animates: a press inverts instantly, as it always did.
   ══════════════════════════════════════════════════════════════════════════ */

/** CSS pixels per panel pixel. */
const S = 2;

/** A one-bit picture, `w` × `h` panel pixels, redrawn every render (they are tiny). */
function Bits({ w, h, draw, className }: { w: number; h: number; draw: (p: Pix) => void; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const p = new Pix(w, h);
    draw(p);
    if (ref.current) paint(ref.current, p, S);
  });
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

/** The width of an element in panel pixels, kept up to date. A callback ref,
 *  so it starts measuring whenever the element actually mounts. */
function usePanelWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    const read = () => setW(Math.floor(el.clientWidth / S));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

/** Text in the bitmap face, cut to `max` panel pixels with an ellipsis. */
function Label({ text, face = Small, max, className }: { text: string; face?: typeof Small; max?: number; className?: string }) {
  const shown = max ? fit(face, text, max) : text;
  const w = Math.max(1, measure(face, shown));
  const h = face.cap + face.desc + 3;
  return <Bits className={`pk-bits${className ? ` ${className}` : ''}`} w={w} h={h} draw={(p) => p.text(face, shown, 0, 3)} />;
}

// ── A horizontal slider, drawn ───────────────────────────────────────────────

interface SliderGeom {
  /** first and last pixel the thumb's centre can sit on */
  x0: number;
  x1: number;
}

const geom = (w: number): SliderGeom => ({ x0: 5, x1: Math.max(6, w - 6) });

function useDrag(onValue: (v: number, final: boolean) => void, x0: number, x1: number) {
  const [dragging, setDragging] = useState(false);
  const valueAt = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    const px = (clientX - r.left) / S;
    return Math.max(0, Math.min(1, (px - x0) / Math.max(1, x1 - x0))) * 100;
  };
  return {
    dragging,
    handlers: {
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        onValue(valueAt(e.currentTarget, e.clientX), false);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        if (!dragging) return;
        onValue(valueAt(e.currentTarget, e.clientX), false);
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        if (!dragging) return;
        setDragging(false);
        onValue(valueAt(e.currentTarget, e.clientX), true);
      },
      onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
        if (!dragging) return;
        setDragging(false);
        onValue(valueAt(e.currentTarget, e.clientX), true);
      },
    },
  };
}

/** The group slider: track, 50% fill, eight notches numbered 0–7, the knob. */
function drawGroupSlider(p: Pix, value: number) {
  const { x0, x1 } = geom(p.w);
  const at = Math.round(x0 + ((x1 - x0) * value) / 100);
  // track: an outlined bar, filled with the desktop grey up to the knob
  p.frame(x0 - 2, 5, x1 - x0 + 5, 5);
  p.fill(x0 - 1, 6, x1 - x0 + 3, 3, WHITE);
  if (at > x0 - 1) p.dither(x0 - 1, 6, at - x0 + 1, 3);
  for (let i = 0; i <= 7; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / 7);
    p.vline(x, 16, 18);
    const d = String(i);
    p.text(Small, d, x - Math.floor(measure(Small, d) / 2), 21);
  }
  knob(p, at, 1);
}

/** A room's slider: thin track, ticks under it, the pointer thumb. */
function drawRoomSlider(p: Pix, value: number, muted: boolean) {
  const { x0, x1 } = geom(p.w);
  const at = Math.round(x0 + ((x1 - x0) * value) / 100);
  p.frame(x0 - 2, 3, x1 - x0 + 5, 4);
  p.fill(x0 - 1, 4, x1 - x0 + 3, 2, WHITE);
  if (!muted && at > x0 - 1) p.dither(x0 - 1, 4, at - x0 + 1, 2);
  for (let i = 0; i <= 10; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / 10);
    p.vline(x, 12, i % 5 === 0 ? 14 : 13);
  }
  pointer(p, at, 0);
}

// ── The group's volume ───────────────────────────────────────────────────────

function GroupVolume() {
  const volume = useSonos((s) => s.state?.volume ?? 0);
  const muted = useSonos((s) => !!s.state?.muted);
  const setGroupVolume = useSonos((s) => s.setGroupVolume);
  const [wrap, w] = usePanelWidth<HTMLDivElement>();
  const g = geom(w);
  const drag = useDrag((v, final) => void setGroupVolume(v, final), g.x0, g.x1);
  const wheelTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onWheel = (e: React.WheelEvent) => {
    const step = e.deltaY < 0 ? 2 : -2;
    void setGroupVolume((useSonos.getState().state?.volume ?? volume) + step);
    clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => {
      void setGroupVolume(useSonos.getState().state?.volume ?? volume, true);
    }, 180);
  };

  useEffect(() => () => clearTimeout(wheelTimer.current), []);

  return (
    <div className="pk-sound">
      <Label text="Speaker volume" />
      <div className="pk-sound-head">
        <Bits className="pk-bits" w={18} h={14} draw={(p) => speaker(p, 0, 0, wavesFor(volume), muted || volume === 0)} />
        <Label face={Bold} text={String(volume)} className="pk-sound-value" />
      </div>
      <div
        ref={wrap}
        className={`pk-slider pk-slider-group${drag.dragging ? ' is-dragging' : ''}`}
        {...drag.handlers}
        onWheel={onWheel}
        role="slider"
        tabIndex={0}
        aria-label="Group volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volume}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') void setGroupVolume(volume + 2, true);
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') void setGroupVolume(volume - 2, true);
          else if (e.key === 'PageUp') void setGroupVolume(volume + 10, true);
          else if (e.key === 'PageDown') void setGroupVolume(volume - 10, true);
          else return;
          e.preventDefault();
        }}
      >
        {w > 20 && <Bits w={w} h={29} draw={(p) => drawGroupSlider(p, volume)} />}
      </div>
    </div>
  );
}

// ── A room ───────────────────────────────────────────────────────────────────

function Room({ member, nameMax }: { member: MemberVolume; nameMax: number }) {
  const setMemberVolume = useSonos((s) => s.setMemberVolume);
  const setMemberMute = useSonos((s) => s.setMemberMute);
  const [wrap, w] = usePanelWidth<HTMLDivElement>();
  const g = geom(w);
  const onValue = useCallback(
    (v: number, final: boolean) => void setMemberVolume(member.uuid, v, final),
    [setMemberVolume, member.uuid],
  );
  const drag = useDrag(onValue, g.x0, g.x1);

  return (
    <li className={`pk-room${member.muted ? ' is-muted' : ''}`}>
      <button
        type="button"
        className="pk-mute"
        aria-label={member.muted ? `Unmute ${member.name}` : `Mute ${member.name}`}
        aria-pressed={member.muted}
        onClick={() => void setMemberMute(member.uuid, !member.muted)}
      >
        <Bits w={19} h={15} draw={(p) => speaker(p, 1, 1, wavesFor(member.volume), member.muted)} />
      </button>
      <span className="pk-room-name" title={member.name} style={{ width: nameMax * S }}>
        <Label face={Bold} text={member.name} max={nameMax} />
      </span>
      <div
        ref={wrap}
        className={`pk-slider pk-slider-room${drag.dragging ? ' is-dragging' : ''}`}
        {...drag.handlers}
        role="slider"
        tabIndex={0}
        aria-label={`${member.name} volume`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={member.volume}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') void setMemberVolume(member.uuid, member.volume + 2, true);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') void setMemberVolume(member.uuid, member.volume - 2, true);
          else return;
          e.preventDefault();
        }}
      >
        {w > 20 && <Bits w={w} h={15} draw={(p) => drawRoomSlider(p, member.volume, member.muted)} />}
      </div>
      <span className="pk-room-value">
        <Bits w={measure(Small, '100', { tabular: true })} h={10} draw={(p) => {
          const t = String(member.volume);
          p.text(Small, t, p.w - measure(Small, t, { tabular: true }), 2, BLACK, { tabular: true });
        }} />
      </span>
    </li>
  );
}

// ── The window ───────────────────────────────────────────────────────────────

export default function PocketPanel({ title = 'Sound' }: { title?: string }) {
  const members = useSonos((s) => s.state?.members);
  const hasState = useSonos((s) => !!s.state);
  const [list, listW] = usePanelWidth<HTMLUListElement>();
  if (!hasState || !members) return null;
  // The name column takes what the row can spare (a third, within reason),
  // always leaving the slider about sixty pixels.
  const nameMax = Math.max(30, Math.min(120, Math.floor(listW * 0.42), listW - 112));
  const tw = measure(Bold, title);

  return (
    <div className="pk-win" role="group" aria-label="Volume">
      <div className="pk-win-title" aria-hidden="true">
        <Bits className="pk-win-close" w={13} h={13} draw={(p) => {
          p.fill(0, 0, 13, 13, WHITE);
          p.frame(1, 1, 11, 11);
        }} />
        <Bits className="pk-win-name" w={tw + 10} h={13} draw={(p) => {
          p.fill(0, 0, p.w, p.h, WHITE);
          p.text(Bold, title, 5, 2);
        }} />
      </div>
      <div className="pk-win-body">
        <GroupVolume />
        <i className="pk-win-rule" aria-hidden="true" />
        <div className="pk-rooms-col">
          <Label text={members.length === 1 ? 'Room' : 'Rooms'} className="pk-rooms-caption" />
          <ul className="pk-rooms" ref={list}>
            {members.map((m) => (
              <Room key={m.uuid} member={m} nameMax={nameMax} />
            ))}
          </ul>
        </div>
      </div>
      <Bits className="pk-win-grow" w={15} h={15} draw={(p) => {
        p.fill(0, 0, 15, 15, WHITE);
        p.vline(0, 0, 14);
        p.hline(0, 14, 0);
        p.frame(3, 3, 7, 7);
        p.fill(6, 6, 7, 7, WHITE);
        p.frame(5, 5, 8, 8);
        p.set(0, 0, BLACK);
        p.set(14, 14, CLEAR);
      }} />
    </div>
  );
}
