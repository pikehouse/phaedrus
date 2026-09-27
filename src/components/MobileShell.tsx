import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSonos } from '../store/useSonos';
import { useSettingsPanel } from '../store/settings';
import NowPlaying from './NowPlaying';
import Queue from './Queue';
import Crate from './Crate';
import RoomsRail from './RoomsRail';
import { Close, Disc, Gear, Search, Sleeves, Speaker, Tracklist } from './Icons';
import '../styles/mobile.css';

type Tab = 'now' | 'queue' | 'crate' | 'rooms';
type Sheet = 'rooms' | null;

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'now', label: 'Now Playing', icon: <Disc /> },
  { id: 'queue', label: 'Queue', icon: <Tracklist /> },
  { id: 'crate', label: 'Crate', icon: <Sleeves /> },
  { id: 'rooms', label: 'Rooms', icon: <Speaker /> },
];

/**
 * The same instrument, stood upright: a header strip, one page at a time,
 * a tab bar. Every page is a desktop component rendered whole — the stage
 * with its faceplate, the queue, the crate, the rooms rail — and the chrome
 * around them speaks only in tokens, so each skin colours it.
 */
export default function MobileShell() {
  const [tab, setTab] = useState<Tab>('now');
  const [sheet, setSheet] = useState<Sheet>(null);
  const group = useSonos((s) => s.group);
  const setSearchOpen = useSonos((s) => s.setSearchOpen);
  const openSettings = useSettingsPanel((s) => s.setOpen);

  // Fixed chrome outside this tree (the status strip, the search overlay)
  // reads this to keep clear of the tab bar and the notch.
  useEffect(() => {
    document.documentElement.dataset.shell = 'phone';
    return () => {
      delete document.documentElement.dataset.shell;
    };
  }, []);

  // The rooms sheet is a switchboard: pick a room and it gets out of the way.
  const groupId = group?.id;
  const sheetGroup = useRef(groupId);
  useEffect(() => {
    if (sheet === 'rooms' && groupId !== sheetGroup.current) setSheet(null);
  }, [sheet, groupId]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const openRooms = () => {
    if (tab === 'rooms') return;
    sheetGroup.current = groupId;
    setSheet('rooms');
  };

  const others = group ? group.members.length - 1 : 0;

  return (
    <div className="phone">
      <header className="phone-head">
        <button type="button" className="phone-room" onClick={openRooms} aria-label="Change room">
          <span className="phone-room-marker" aria-hidden="true" />
          <span className="phone-room-text">
            <span className="room-name">{group?.name ?? '—'}</span>
            {group && others > 0 && (
              <span className="room-with">
                + {others === 1 ? group.members[1].name : `${others} more`}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          className="phone-tool"
          aria-label="Search music"
          onClick={() => setSearchOpen(true)}
        >
          <Search size={20} />
        </button>
        <button
          type="button"
          className="phone-tool"
          aria-label="Settings"
          onClick={() => {
            setSheet(null);
            openSettings(true);
          }}
        >
          <Gear size={20} />
        </button>
      </header>

      <main className="phone-page" data-tab={tab}>
        {tab === 'now' && <NowPlaying />}
        {tab === 'queue' && <Queue />}
        {tab === 'crate' && <Crate />}
        {tab === 'rooms' && <RoomsRail />}
      </main>

      <nav className="phone-tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`mtab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            <span className="label mtab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {sheet === 'rooms' && (
        <Sheet label="Rooms" onClose={closeSheet}>
          <RoomsRail />
        </Sheet>
      )}
    </div>
  );
}

/** A bottom sheet. With a `title` it carries its own head; without, the content brings one. */
function Sheet({
  label,
  title,
  onClose,
  children,
}: {
  label: string;
  title?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Search and Settings open above the sheet; that Escape is theirs alone.
      if (useSonos.getState().searchOpen || useSettingsPanel.getState().open) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="sheet-dismiss" aria-label="Close" onClick={onClose} />
      <div className="sheet">
        <i className="sheet-grip" aria-hidden="true" />
        {title && (
          <header className="sheet-head">
            <h2 className="label sheet-title">{title}</h2>
            <button type="button" className="phone-tool" aria-label="Close" onClick={onClose}>
              <Close size={18} />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
