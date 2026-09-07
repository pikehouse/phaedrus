import { useEffect } from 'react';
import { startPolling, stopPolling, useSonos } from './store/useSonos';
import Atmosphere from './components/Atmosphere';
import RoomsRail from './components/RoomsRail';
import NowPlaying from './components/NowPlaying';
import RightRail from './components/RightRail';
import SearchOverlay from './components/SearchOverlay';
import StatusStrip from './components/StatusStrip';
import Vinyl from './components/Vinyl';
import MobileShell from './components/MobileShell';
import { useViewport } from './hooks/useViewport';
import './styles/app.css';

export default function App() {
  const phase = useSonos((s) => s.phase);
  const boot = useSonos((s) => s.boot);
  const shell = useViewport();

  useEffect(() => {
    void boot();
    startPolling();
    return stopPolling;
  }, [boot]);

  useKeyboard();

  return (
    <>
      <Atmosphere />
      {phase === 'booting' && <Booting />}
      {phase === 'nothing' && <Nothing />}
      {phase === 'ready' &&
        (shell === 'phone' ? (
          <MobileShell />
        ) : (
          <div className="shell">
            <RoomsRail />
            <NowPlaying />
            <RightRail />
          </div>
        ))}
      <SearchOverlay />
      <StatusStrip />
    </>
  );
}

/** Global hotkeys. Anything typed into an input or aimed at a slider is left alone. */
function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useSonos.getState();
      const el = document.activeElement as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable === true;
      const onSlider = el?.getAttribute('role') === 'slider';

      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault();
        s.setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        if (s.searchOpen) return; // the overlay handles its own escape
        if (s.arranging) s.setArranging(false);
        return;
      }
      if (typing || s.searchOpen) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          void s.toggle();
          break;
        case 'ArrowLeft':
          if (onSlider) return;
          e.preventDefault();
          void s.nudge(-10);
          break;
        case 'ArrowRight':
          if (onSlider) return;
          e.preventDefault();
          void s.nudge(10);
          break;
        case 'ArrowUp':
          if (onSlider) return;
          e.preventDefault();
          void s.bumpVolume(2);
          break;
        case 'ArrowDown':
          if (onSlider) return;
          e.preventDefault();
          void s.bumpVolume(-2);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Booting() {
  return (
    <div className="curtain" data-tauri-drag-region>
      <Vinyl playing />
      <p className="curtain-title">Finding your speakers…</p>
      <p className="label curtain-sub">Listening on this network</p>
    </div>
  );
}

function Nothing() {
  const rediscover = useSonos((s) => s.rediscover);
  const busy = useSonos((s) => s.busy);
  return (
    <div className="curtain" data-tauri-drag-region>
      <Vinyl playing={busy} />
      <p className="curtain-title">No Sonos found on this Wi-Fi.</p>
      <p className="label curtain-sub">Same network as the speakers?</p>
      <button type="button" className="curtain-btn" onClick={() => void rediscover()} disabled={busy}>
        {busy ? 'Looking…' : 'Look again'}
      </button>
    </div>
  );
}
