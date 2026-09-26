import { useEffect, useMemo, useState } from 'react';
import { livePosition, useSonos } from '../store/useSonos';
import { mmss } from '../lib/format';
import Progress from './Progress';
import Transport from './Transport';
import TunerSegment14 from './TunerSegment14';

/** "01:18" — minutes padded so the readout never changes width. */
function clock(secs: number): string {
  const s = mmss(Math.max(0, secs));
  return s.length === 4 ? `0${s}` : s;
}

/**
 * Whole seconds into the track. The readouts only change once a second, so
 * they tick once a second — and not at all while paused, when the position
 * only moves if a poll says so.
 */
function useWholeSeconds(): number {
  const receivedAt = useSonos((s) => s.receivedAt);
  const playing = useSonos((s) => s.state?.state === 'PLAYING' || s.state?.state === 'TRANSITIONING');
  const [secs, setSecs] = useState(() => Math.floor(livePosition(useSonos.getState())));
  useEffect(() => {
    const read = () => setSecs(Math.floor(livePosition(useSonos.getState())));
    read();
    if (!playing) return;
    let timer = 0;
    // Land each tick just after the second turns over, not up to a second late.
    const tick = () => {
      read();
      const frac = livePosition(useSonos.getState()) % 1;
      timer = window.setTimeout(tick, Math.max(40, (1 - frac) * 1000 + 20));
    };
    tick();
    return () => clearTimeout(timer);
  }, [receivedAt, playing]);
  return secs;
}

/**
 * A 1985 digital dash under the windshield: a chrome bezel round a black
 * panel, backlit rubber keys on the left, and on the right a smoked
 * instrument window with segmented sodium readouts either side of the road.
 * Transport and Progress are the app's own; this only frames them.
 */
export default function DriveDash() {
  const state = useSonos((s) => s.state);
  const whole = useWholeSeconds();
  const duration = state?.durationSecs ?? 0;
  const radio = !!state?.isRadio;
  const timed = !!state && !radio && duration > 0;

  const elapsed = useMemo(
    () =>
      state ? (
        <TunerSegment14 text={clock(whole)} className="drive-seg" label={`${mmss(whole)} elapsed`} />
      ) : (
        <TunerSegment14 text="--:--" className="drive-seg is-dark" label="Nothing playing" />
      ),
    [whole, !!state], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const right = useMemo(() => {
    if (radio) return <TunerSegment14 text=" LIVE" className="drive-seg" label="Live broadcast" />;
    if (!timed) return <TunerSegment14 text="-- --" className="drive-seg is-dark" label="No track length" />;
    const left = Math.max(0, duration - whole);
    return <TunerSegment14 text={`-${clock(left)}`} className="drive-seg" label={`${mmss(left)} remaining`} />;
  }, [radio, timed, duration, whole]);

  return (
    <div className="drive-dash">
      <div className="drive-dash-bezel">
        <div className="drive-dash-panel">
          <div className="drive-dash-keys">
            <Transport />
          </div>

          <div className="drive-dash-window">
            <div className="drive-gauge">
              <span className="drive-gauge-label">Elapsed</span>
              {elapsed}
            </div>
            <div className="drive-dash-road">
              <Progress />
            </div>
            <div className="drive-gauge is-right">
              <span className="drive-gauge-label">{radio ? 'Signal' : 'Remain'}</span>
              {right}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
