import { useEffect, useState } from 'react';
import Vinyl from './Vinyl';
import { averageColor } from '../lib/color';
import '../styles/hero.css';

interface Props {
  art?: string;
  playing: boolean;
  /** Something is loaded (even if paused) — the record is pulled out of the sleeve. */
  loaded: boolean;
  title?: string;
  /** Shown on the printed sleeve when there is no artwork. */
  fallbackLine?: string;
}

/**
 * The picture the whole app is built around: an LP jacket with the record
 * slid out of the open side, turning. The jacket carries the artwork large;
 * the disc's label carries it small. Nothing is playing → the disc tucks in.
 */
export default function Hero({ art, playing, loaded, title, fallbackLine }: Props) {
  const [glow, setGlow] = useState<string | null>(null);
  const [artOk, setArtOk] = useState(true);

  useEffect(() => {
    let alive = true;
    setArtOk(true);
    if (!art) {
      setGlow(null);
      return;
    }
    averageColor(art).then((c) => {
      if (alive) setGlow(c);
    });
    return () => {
      alive = false;
    };
  }, [art]);

  const showArt = !!art && artOk;

  return (
    <div
      className={`hero${loaded ? ' is-out' : ' is-in'}`}
      style={glow ? ({ '--glow': glow } as React.CSSProperties) : undefined}
    >
      <div className={`hero-ambient${glow ? ' is-sampled' : ''}`} aria-hidden="true" />

      <div className="hero-disc">
        <Vinyl art={showArt ? art : undefined} playing={playing} title={title} onArtError={() => setArtOk(false)} />
      </div>
      <div className="hero-mouth" aria-hidden="true" />

      <div className="sleeve">
        {showArt ? (
          <img
            className="sleeve-art"
            src={art}
            alt={title ? `Album art for ${title}` : ''}
            draggable={false}
            onError={() => setArtOk(false)}
          />
        ) : (
          <div className="sleeve-print" aria-hidden="true">
            <span className="sleeve-print-mark">Phædrus · 33⅓</span>
            <span className="sleeve-print-title">{fallbackLine ?? title ?? 'Nothing on'}</span>
          </div>
        )}
        <i className="sleeve-paper" aria-hidden="true" />
        <i className="sleeve-ring" aria-hidden="true" />
        <i className="sleeve-edge" aria-hidden="true" />
        <i className="sleeve-spine" aria-hidden="true" />
      </div>
    </div>
  );
}
