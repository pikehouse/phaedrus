import { useEffect, useRef, useState } from 'react';

const KEY = 'phaedrus.drive.color';
/** The mosaic's resolution: the cover drawn this small, shown panel-size. */
const PIX = 96;

function recallColor(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

interface Props {
  art?: string;
  title?: string;
  /** Nothing loaded: a black panel with the chrome badge. */
  idle: boolean;
}

/**
 * The cover as a panel floating over wet ground: tilted a few degrees toward
 * the road, a hairline of chrome round it, and its own reflection beneath —
 * flipped, faded, and smeared sideways the way a wet street smears a light.
 *
 * By default the picture is graded into the scene's own light — a coarse
 * mosaic under an indigo-to-sodium tritone and scanlines, as if shot on the
 * same night. COLOR shows it as it is; the reflection follows either way.
 */
export default function DriveCover({ art, title, idle }: Props) {
  const [ok, setOk] = useState(true);
  const [color, setColor] = useState(recallColor);
  const pix = useRef<HTMLCanvasElement>(null);
  const pixMirror = useRef<HTMLCanvasElement>(null);

  useEffect(() => setOk(true), [art]);

  const show = !idle && !!art && ok;

  // Nothing is ever read back from the canvas, so a cover without CORS
  // headers still draws — the canvas is merely tainted.
  useEffect(() => {
    const canvases = [pix.current, pixMirror.current];
    const clear = () => canvases.forEach((c) => c?.getContext('2d')?.clearRect(0, 0, PIX, PIX));
    if (!art || !show) {
      clear();
      return;
    }
    let alive = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!alive) return;
      for (const c of canvases) {
        const ctx = c?.getContext('2d');
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, PIX, PIX);
        ctx.drawImage(img, 0, 0, PIX, PIX);
      }
    };
    img.onerror = () => {
      if (alive) clear();
    };
    img.src = art;
    return () => {
      alive = false;
    };
  }, [art, show]);

  const toggle = () => {
    const next = !color;
    setColor(next);
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      /* the choice just won't survive a restart */
    }
  };

  const face = (mirror: boolean) => (
    <div className={`drive-cover-face${show ? ' is-art' : ''}`}>
      {show ? (
        <>
          <img
            src={art}
            alt={mirror ? '' : title ? `Album art for ${title}` : ''}
            draggable={false}
            onError={mirror ? undefined : () => setOk(false)}
          />
          <canvas
            ref={mirror ? pixMirror : pix}
            className="drive-cover-pix"
            width={PIX}
            height={PIX}
            aria-hidden="true"
          />
          <i className="drive-cover-scan" aria-hidden="true" />
        </>
      ) : (
        <span className="drive-cover-badge" aria-hidden="true">
          PHÆDRUS
        </span>
      )}
    </div>
  );

  return (
    <div className={`drive-cover${show ? '' : ' is-blank'}${color ? ' is-color' : ''}`}>
      <i className="drive-cover-glow" aria-hidden="true" />

      <div className="drive-cover-panel">
        {face(false)}
        {show && (
          <button
            type="button"
            className="drive-cover-color"
            onClick={toggle}
            aria-pressed={color}
            aria-label={color ? 'Show the cover graded for the night' : 'Show the cover in colour'}
          >
            Color
          </button>
        )}
      </div>

      <div className="drive-cover-reflection" aria-hidden="true">
        <div className="drive-cover-mirror">{face(true)}</div>
      </div>

      {/* A blur with a direction: CSS blur() is round, a wet road is not. */}
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <filter id="drive-hblur" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="2.6 0.35" />
        </filter>
      </svg>
    </div>
  );
}
