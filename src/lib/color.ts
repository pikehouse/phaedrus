/**
 * Average colour of an image, for the ambient glow behind the record.
 *
 * Art comes from LAN speakers and third-party CDNs, so CORS is a coin flip.
 * We try with crossOrigin set; if the canvas ends up tainted (or anything else
 * goes wrong) we resolve null and the caller falls back to plain amber.
 */
export function averageColor(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      const timer = setTimeout(() => done(null), 4000);

      img.onload = () => {
        clearTimeout(timer);
        try {
          const n = 24; // a 24x24 thumbnail is plenty for an average
          const canvas = document.createElement('canvas');
          canvas.width = n;
          canvas.height = n;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return done(null);
          ctx.drawImage(img, 0, 0, n, n);
          const { data } = ctx.getImageData(0, 0, n, n);
          let r = 0;
          let g = 0;
          let b = 0;
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 24) continue;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
          if (!count) return done(null);
          // Push toward the warm end and keep it saturated enough to read as
          // light rather than mud.
          const warm = (v: number, bias: number) => Math.round(Math.min(255, v / count + bias));
          done(`rgb(${warm(r, 26)}, ${warm(g, 6)}, ${warm(b, -10)})`);
        } catch {
          done(null); // tainted canvas
        }
      };

      img.onerror = () => {
        clearTimeout(timer);
        done(null);
      };
      img.src = url;
    } catch {
      done(null);
    }
  });
}
