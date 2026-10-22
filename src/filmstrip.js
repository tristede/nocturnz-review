import { useEffect, useState } from 'react';

// Pellicule de la timeline mobile : quelques images de la vidéo, prises par un second lecteur caché.
// Les images ne sont que dessinées à l'écran (jamais relues) : une vidéo d'un autre domaine convient.
// YouTube : on ne peut pas lire ses images, on répète sa vignette publique.
export function useFilmstrip({ src = null, poster = null, dur = 0 }) {
  const [strip, setStrip] = useState({ frames: [], ratio: 16 / 9 });
  useEffect(() => {
    setStrip({ frames: [], ratio: 16 / 9 });
    if (poster) {
      const img = new Image();
      img.onload = () => setStrip({ frames: [{ t: 0, img }], ratio: img.naturalWidth / img.naturalHeight || 16 / 9 });
      img.src = poster;
      return () => { img.onload = null; };
    }
    if (!src || !dur) return;
    let dead = false;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.setAttribute('playsinline', '');
    const seek = (t) => new Promise((done) => {
      const end = () => { clearTimeout(timer); v.removeEventListener('seeked', end); done(); };
      const timer = setTimeout(end, 5000);
      v.addEventListener('seeked', end);
      v.currentTime = t;
    });
    // une image toutes les ~2 s pour un clip court, 32 au plus pour un long métrage
    const count = Math.max(6, Math.min(32, Math.ceil(dur / 2)));
    const start = setTimeout(async () => {
      v.src = src;
      await new Promise((ok) => { v.onloadeddata = ok; v.onerror = ok; setTimeout(ok, 8000); });
      if (dead || !v.videoWidth) return;
      const ratio = v.videoWidth / v.videoHeight, h = 96, w = Math.round(h * ratio);
      const frames = [];
      // du début vers la fin : la partie visible au chargement se remplit en premier
      for (let i = 0; i < count && !dead; i++) {
        const t = Math.min(dur - 0.05, (i + 0.5) * (dur / count));
        await seek(t);
        if (dead) break;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        try { cv.getContext('2d').drawImage(v, 0, 0, w, h); } catch { continue; }
        frames.push({ t: (i * dur) / count, img: cv });
        setStrip({ frames: [...frames], ratio });
      }
      v.removeAttribute('src'); v.load(); // libère le téléchargement
    }, 1200); // on laisse d'abord le lecteur principal charger
    return () => { dead = true; clearTimeout(start); v.removeAttribute('src'); v.load(); };
  }, [src, poster, dur]);
  return strip;
}
