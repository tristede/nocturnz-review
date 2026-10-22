import { useEffect, useRef } from 'react';
import { PEAK_CURVE } from './audioPeaks';

// Indicateur de niveau façon FL Studio : deux barres (gauche / droite) en dBFS, vert → jaune → orange → rouge,
// avec maintien du pic et voyant de saturation. Lu dans l'onde enregistrée (aucun traitement du son en direct).
const FLOOR = -48;                                  // bas de l'échelle (dB)
const ZONES = [[-12, '#3ecf5e'], [-6, '#e8d43a'], [-1, '#ff9a2e'], [0.01, '#ff3b3b']]; // seuils hauts de chaque couleur
// niveau relatif (pic absolu inconnu) : une seule teinte, on ne peut rien dire de la saturation
const REL = ['#5d4a8a', '#8a6fd1', '#b9a2f2'];
const colorOf = (db, rel = false) => rel ? REL[db > -6 ? 2 : db > -18 ? 1 : 0] : (ZONES.find(([top]) => db <= top) || ZONES[ZONES.length - 1])[1];
const CLIP = -0.01; // saturation : 0 dBFS atteint (pas avant)
const SCALE = [-48, -36, -24, -12, -6, -3, 0];

export default function AudioMeter({ peaks, dur, getTime, playing, now, vertical = false }) {
  const cv = useRef(null), readout = useRef(null);
  const st = useRef({ hold: [FLOOR, FLOOR], holdAt: [0, 0], clip: 0 });

  useEffect(() => {
    if (!peaks || !dur) return;
    const rel = !peaks.max, max = peaks.max || 1;    // sans pic absolu enregistré : niveau relatif (0 dB = pic du fichier)
    const chans = [peaks.l, peaks.r || peaks.l];
    const n = peaks.l.length;
    const level = (arr, t) => {                       // pic des 60 dernières ms, en dB
      const i1 = Math.min(n - 1, Math.floor((t / dur) * n)), i0 = Math.max(0, Math.floor(((t - 0.06) / dur) * n));
      let m = 0;
      for (let i = i0; i <= i1; i++) if (arr[i] > m) m = arr[i];
      const amp = Math.pow(m / 255, 1 / PEAK_CURVE) * max;
      return amp > 0 ? Math.max(FLOOR, 20 * Math.log10(amp)) : FLOOR;
    };
    let raf = 0;
    const draw = () => {
      const c = cv.current;
      if (!c) return;
      const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
      if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const t = getTime(), now = performance.now(), s = st.current;
      const len = vertical ? h : w, thick = vertical ? w : h;
      const lane = (thick - 2) / 2;
      const pos = (db) => ((db - FLOOR) / -FLOOR) * len;    // position le long de la barre
      const segs = Math.max(12, Math.floor(len / 4));         // LED : un segment tous les 4 px
      chans.forEach((arr, k) => {
        const db = level(arr, t);
        if (db >= s.hold[k] || now - s.holdAt[k] > 1500) { s.hold[k] = db; s.holdAt[k] = now; }
        if (!rel && db >= CLIP) s.clip = now;
        const off = k * (lane + 2);
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * len, b = ((i + 1) / segs) * len - 1;
          const segDb = FLOOR + ((i + 0.5) / segs) * -FLOOR;
          g.fillStyle = colorOf(segDb, rel);
          g.globalAlpha = a < pos(db) ? 1 : 0.13;
          if (vertical) g.fillRect(off, h - b, lane, b - a); else g.fillRect(a, off, b - a, lane);
        }
        g.globalAlpha = 1;
        const hp = pos(s.hold[k]);                             // maintien du pic
        if (s.hold[k] > FLOOR + 1) { g.fillStyle = colorOf(s.hold[k], rel); if (vertical) g.fillRect(off, h - hp, lane, 2); else g.fillRect(hp - 2, off, 2, lane); }
      });
      const peak = Math.max(...s.hold);
      if (readout.current) {
        readout.current.textContent = rel ? '' : peak <= FLOOR + 0.5 ? '−∞' : `${peak.toFixed(1).replace('.', ',').replace('-', '−')} dB`;
        readout.current.style.color = !rel && now - s.clip < 2000 ? '#ff3b3b' : rel ? '#b9a2f2' : colorOf(peak);
      }
      if (playing) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [peaks, dur, getTime, playing, vertical, playing ? 0 : now]); // en pause : redessiné à chaque déplacement

  if (!peaks) return null;
  return (
    <div className={`meter ${vertical ? 'v' : 'h'}`} title={peaks.max ? 'Niveau crête (dBFS)' : 'Niveau relatif : 0 dB = pic du fichier'}>
      <span className="meter-lr" aria-hidden="true"><i>L</i><i>R</i></span>
      <div className="meter-body">
        <canvas ref={cv} />
        {peaks.max && <div className="meter-scale" aria-hidden="true">{SCALE.map((db) => <span key={db} style={{ [vertical ? 'bottom' : 'left']: `${((db - FLOOR) / -FLOOR) * 100}%` }}>{db === 0 ? '0' : db}</span>)}</div>}
      </div>
      <b ref={readout} className="meter-db">−∞</b>
      {!peaks.max && <small className="meter-rel">niveau relatif</small>}
    </div>
  );
}
