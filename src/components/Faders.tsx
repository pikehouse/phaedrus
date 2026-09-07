import { useCallback, useRef, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { Muted, Sound } from './Icons';
import type { MemberVolume } from '../api/types';
import '../styles/faders.css';

export default function Faders() {
  const state = useSonos((s) => s.state);
  if (!state || state.members.length === 0) return null;

  return (
    <div className="faders">
      <span className="label faders-caption">
        {state.members.length === 1 ? 'Room' : 'Rooms'}
      </span>
      <ul className="faders-list">
        {state.members.map((m) => (
          <Fader key={m.uuid} member={m} />
        ))}
      </ul>
    </div>
  );
}

function Fader({ member }: { member: MemberVolume }) {
  const setMemberVolume = useSonos((s) => s.setMemberVolume);
  const setMemberMute = useSonos((s) => s.setMemberMute);
  const railRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const valueAt = useCallback(
    (clientX: number) => {
      const el = railRef.current;
      if (!el) return member.volume;
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * 100;
    },
    [member.volume],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    void setMemberVolume(member.uuid, valueAt(e.clientX));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    void setMemberVolume(member.uuid, valueAt(e.clientX));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    void setMemberVolume(member.uuid, valueAt(e.clientX), true);
  };

  const pct = member.muted ? 0 : member.volume;

  return (
    <li className={`fader${member.muted ? ' is-muted' : ''}`}>
      <button
        type="button"
        className="fader-mute"
        aria-label={member.muted ? `Unmute ${member.name}` : `Mute ${member.name}`}
        aria-pressed={member.muted}
        onClick={() => void setMemberMute(member.uuid, !member.muted)}
      >
        {member.muted ? <Muted size={14} /> : <Sound size={14} />}
      </button>
      <span className="fader-name" title={member.name}>
        {member.name}
      </span>
      <div
        className={`fader-rail${dragging ? ' is-dragging' : ''}`}
        ref={railRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="slider"
        tabIndex={0}
        aria-label={`${member.name} volume`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={member.volume}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp')
            void setMemberVolume(member.uuid, member.volume + 2, true);
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')
            void setMemberVolume(member.uuid, member.volume - 2, true);
        }}
      >
        <div className="fader-slot" />
        <div className="fader-fill" style={{ width: `${pct}%` }} />
        <div className="fader-cap" style={{ left: `${pct}%` }} />
      </div>
      <span className="num fader-value">{member.volume}</span>
    </li>
  );
}
