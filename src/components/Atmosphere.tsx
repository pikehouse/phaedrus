import '../styles/atmosphere.css';

/**
 * The room the app sits in: a warm vignette, an amber light leak drifting in
 * the upper right, and film grain over everything (including modals — it reads
 * as one photograph that way). Purely decorative, never interactive.
 */
export default function Atmosphere() {
  return (
    <div className="atmo" aria-hidden="true">
      <div className="atmo-leak" />
      <div className="atmo-vignette" />
      <div className="atmo-grain">
        <i className="grain-frame grain-a" />
        <i className="grain-frame grain-b" />
        <i className="grain-frame grain-c" />
      </div>
    </div>
  );
}
