import { useEffect, useState } from 'react';
import { useSonos } from '../store/useSonos';
import { useSettingsPanel } from '../store/settings';
import { plural } from '../lib/format';
import { Gear, Radar } from './Icons';
import type { Zone } from '../api/types';
import '../styles/rooms.css';

export default function RoomsRail() {
  const topology = useSonos((s) => s.topology);
  const group = useSonos((s) => s.group);
  const state = useSonos((s) => s.state);
  const arranging = useSonos((s) => s.arranging);
  const busy = useSonos((s) => s.busy);
  const selectGroup = useSonos((s) => s.selectGroup);
  const setArranging = useSonos((s) => s.setArranging);
  const everywhere = useSonos((s) => s.everywhere);
  const rediscover = useSonos((s) => s.rediscover);
  const openSettings = useSettingsPanel((s) => s.setOpen);

  // Re-render the "found 4s ago" line without polling anything.
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const groups = topology?.groups ?? [];
  const roomCount = groups.reduce((n, g) => n + g.members.length, 0);
  const playing = state?.state === 'PLAYING' || state?.state === 'TRANSITIONING';

  return (
    <aside className="rail rooms">
      <div className="rooms-drag" data-tauri-drag-region />

      <header className="rooms-head">
        <h2 className="label">Rooms</h2>
        <button
          type="button"
          className={`rooms-arrange${arranging ? ' is-on' : ''}`}
          onClick={() => setArranging(!arranging)}
          aria-pressed={arranging}
        >
          {arranging ? 'done' : 'arrange'}
        </button>
      </header>

      {arranging ? (
        <ArrangeList />
      ) : (
        <ul className="rooms-list scroll">
          {groups.map((g) => {
            const selected = g.id === group?.id;
            const others = g.members.slice(1);
            return (
              <li key={g.id}>
                <button
                  type="button"
                  className={`room${selected ? ' is-selected' : ''}`}
                  onClick={() => selectGroup(g)}
                  aria-current={selected}
                >
                  <span className="room-marker" aria-hidden="true" />
                  <span className="room-text">
                    <span className="room-name">{g.name}</span>
                    {others.length > 0 && (
                      <span className="room-with">+ {others.map((m) => m.name).join(', ')}</span>
                    )}
                  </span>
                  {/* State is only known for the group we poll — never guess for the rest. */}
                  {selected && playing && <Bars />}
                </button>
              </li>
            );
          })}
          {groups.length === 0 && <li className="rooms-none label">No rooms</li>}
        </ul>
      )}

      {!arranging && groups.length > 1 && (
        <button type="button" className="rooms-everywhere" onClick={() => void everywhere()} disabled={busy}>
          <span className="rooms-everywhere-rule" aria-hidden="true" />
          <span className="label">Everywhere</span>
          <span className="rooms-everywhere-rule" aria-hidden="true" />
        </button>
      )}

      <footer className="rooms-foot">
        <span className="rooms-status num">
          {topology ? plural(roomCount, 'room') : 'looking…'}
        </span>
        <span className="rooms-foot-tools">
          <button
            type="button"
            className="rooms-rescan"
            onClick={() => void rediscover()}
            disabled={busy}
            aria-label="Rescan the network for speakers"
          >
            <Radar size={13} className={busy ? 'is-spinning' : undefined} />
            <span>rescan</span>
          </button>
          <button
            type="button"
            className="rooms-rescan rooms-gear"
            onClick={() => openSettings(true)}
            aria-label="Settings"
            title="Settings (⌘,)"
          >
            <Gear size={14} />
          </button>
        </span>
      </footer>
    </aside>
  );
}

function Bars() {
  return (
    <span className="bars" aria-label="Playing">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Every visible room in the household, switched into or out of the selected group. */
function ArrangeList() {
  const topology = useSonos((s) => s.topology);
  const group = useSonos((s) => s.group);
  const joinRoom = useSonos((s) => s.joinRoom);
  const leaveRoom = useSonos((s) => s.leaveRoom);
  const [pending, setPending] = useState<string | null>(null);

  if (!topology || !group) return null;

  const rooms: Zone[] = topology.groups
    .flatMap((g) => g.members)
    .filter((z) => !z.invisible)
    .sort((a, b) => a.name.localeCompare(b.name));

  const inGroup = new Set(group.members.map((m) => m.uuid));

  const flip = async (z: Zone, on: boolean) => {
    setPending(z.uuid);
    if (on) await joinRoom(z.ip);
    else await leaveRoom(z.ip);
    setPending(null);
  };

  return (
    <div className="arrange scroll">
      <p className="arrange-hint">
        Switch rooms into <em>{group.name}</em>, or set them loose on their own.
      </p>
      <ul className="arrange-list">
        {rooms.map((z) => {
          const on = inGroup.has(z.uuid);
          const isCoordinator = z.uuid === group.coordinatorUuid;
          return (
            <li key={z.uuid} className={`arrange-row${pending === z.uuid ? ' is-pending' : ''}`}>
              <span className="arrange-name">{z.name}</span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${z.name} in ${group.name}`}
                className={`switch${on ? ' is-on' : ''}`}
                disabled={isCoordinator || pending !== null}
                onClick={() => void flip(z, !on)}
              >
                <span className="switch-thumb" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
