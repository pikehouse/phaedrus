import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSonos } from '../store/useSonos';
import { useSettingsPanel } from '../store/settings';
import { PocketDevice } from './PocketStage';
import RoomsRail from './RoomsRail';
import Queue from './Queue';
import Crate from './Crate';
import PocketPanel from './PocketPanel';
import { Close } from './Icons';
import '../styles/mobile.css';

type Sheet = 'rooms' | 'queue' | 'crate' | 'volume';

const SHEET_TITLE: Record<Sheet, string> = {
  rooms: 'Rooms',
  queue: 'Queue',
  crate: 'Favourites',
  volume: 'Room volumes',
};

/**
 * Pocket on a phone: the phone is the player. The white front fills the
 * screen, the LCD sits at the top and the wheel under the thumb does
 * everything the desk version's wheel does.
 *
 * The app's own pages are reached the way the player reaches anything,
 * through its menus: Queue › Edit Queue…, Favourites › Covers…,
 * Rooms › Arrange… and Room Volumes… each slide the full page up as a sheet
 * of white plastic, and Search… and Settings open the app's own overlays.
 */
export default function PocketPhone() {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const group = useSonos((s) => s.group);

  useEffect(() => {
    document.documentElement.dataset.shell = 'phone';
    return () => {
      delete document.documentElement.dataset.shell;
    };
  }, []);

  // Picking a room in the rooms sheet is the end of the errand.
  const groupId = group?.id;
  const opened = useRef(groupId);
  useEffect(() => {
    if (sheet === 'rooms' && groupId !== opened.current && !useSonos.getState().arranging) setSheet(null);
  }, [sheet, groupId]);

  const open = useCallback((s: Sheet) => {
    opened.current = useSonos.getState().group?.id;
    if (s === 'rooms') useSonos.getState().setArranging(true);
    setSheet(s);
  }, []);

  const close = useCallback(() => {
    if (useSonos.getState().arranging) useSonos.getState().setArranging(false);
    setSheet(null);
  }, []);

  return (
    <div className="phone pk-phone">
      <PocketDevice phone onSheet={open} />
      {sheet && (
        <PocketSheet title={SHEET_TITLE[sheet]} onClose={close} bare={sheet === 'volume'}>
          {sheet === 'rooms' && <RoomsRail />}
          {sheet === 'queue' && <Queue />}
          {sheet === 'crate' && <Crate />}
          {sheet === 'volume' && (
            <div className="pk-sheet-volume">
              <PocketPanel stacked onClose={close} />
            </div>
          )}
        </PocketSheet>
      )}
    </div>
  );
}

/** `bare`: the content brings its own title and close (the Sound window). */
function PocketSheet({ title, onClose, bare = false, children }: { title: string; onClose: () => void; bare?: boolean; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useSonos.getState().searchOpen || useSettingsPanel.getState().open) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="sheet-scrim" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet-dismiss" aria-label="Close" onClick={onClose} />
      <div className="sheet pk-sheet">
        <i className="sheet-grip" aria-hidden="true" />
        {!bare && (
          <header className="sheet-head">
            <h2 className="label sheet-title">{title}</h2>
            <button type="button" className="phone-tool" aria-label="Close" onClick={onClose}>
              <Close size={18} />
            </button>
          </header>
        )}
        <div className="pk-sheet-body">{children}</div>
      </div>
    </div>
  );
}
