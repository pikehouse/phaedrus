import { useSonos } from '../store/useSonos';
import '../styles/status.css';

/** One line, bottom centre, fades out. Never a dialog, never a native alert. */
export default function StatusStrip() {
  const toast = useSonos((s) => s.toast);
  return (
    <div className="status-strip" role="status" aria-live="polite">
      {toast && (
        <span key={toast.id} className={`status-pill${toast.tone === 'bad' ? ' is-bad' : ''}`}>
          {toast.text}
        </span>
      )}
    </div>
  );
}
