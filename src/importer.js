// Import d'un fichier depuis l'ordinateur de l'hôte vers son hébergement : contrôle de la place, vignette,
// onde sonore calculée sur place (le fichier est déjà là, inutile de le relire depuis le stockage), envoi.
import { peaksFromLocalMp4, encodePeaks } from './audioPeaks';
import { kindOf, KIND_LABEL } from './links';
import { fmtGB, publicUrl, uploadFile, usage } from './storage';

const rand = () => Math.random().toString(36).slice(2, 8);
const extOf = (name) => (name.match(/\.(\w{1,6})$/)?.[1] || 'bin').toLowerCase();

// durée + image d'aperçu d'une vidéo locale (si le navigateur sait la décoder)
function videoMeta(file) {
  return new Promise((done) => {
    const url = URL.createObjectURL(file);
    const v = Object.assign(document.createElement('video'), { muted: true, preload: 'metadata', playsInline: true, src: url });
    let finished = false;
    const finish = (r) => { if (finished) return; finished = true; URL.revokeObjectURL(url); done(r); };
    setTimeout(() => finish({ duration: v.duration || null, thumb: null }), 15000);
    v.onerror = () => finish({ duration: null, thumb: null });
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 0) * 0.1); };
    v.onseeked = () => {
      if (!v.videoWidth) return finish({ duration: v.duration, thumb: null }); // fichier audio seul : pas d'image
      try {
        const w = 480, h = Math.round((w * v.videoHeight) / v.videoWidth) || 270;
        const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        c.toBlob((b) => finish({ duration: v.duration, thumb: b }), 'image/jpeg', 0.82);
      } catch { finish({ duration: v.duration, thumb: null }); }
    };
  });
}

/**
 * Envoie `file` comme version n de la review aid. Renvoie les champs de version à enregistrer.
 * onStep(texte) décrit l'étape, onProgress(0..1) l'avancement de l'envoi.
 */
export async function importFile({ hosting, file, aid, n = 1, onStep, onProgress, signal }) {
  if (!hosting) throw new Error('Aucun hébergement branché : règle-le dans « Hébergement » avant d’importer.');
  const kind = kindOf(file.type, file.name);
  if (!kind || kind === 'gdoc') throw new Error(`Format non pris en charge (${file.name}). Accepté : vidéo (MP4, MOV, WebM), image, SVG, PDF, Word (.docx), Photoshop (.psd).`);

  onStep?.('Vérification de la place…');
  const { bytes } = await usage(hosting);
  const need = file.size + 200e3; // + vignette
  if (bytes + need > hosting.limitBytes) {
    throw new Error(`Pas assez de place : ${fmtGB(bytes)} utilisés sur ${fmtGB(hosting.limitBytes)}, et ce fichier fait ${fmtGB(file.size)}. Supprime d’anciennes reviews pour libérer de la place.`);
  }

  const key = `r/${aid}/v${n}-${rand()}.${extOf(file.name)}`;
  const url = publicUrl(hosting, key);
  let thumb = kind === 'image' ? url : null, peaks = null, thumbBlob = null, wave = Promise.resolve(null);

  if (kind === 'video') {
    onStep?.('Préparation de l’aperçu…');
    const meta = await videoMeta(file);
    thumbBlob = meta.thumb;
    // l'onde se calcule pendant l'envoi ; un échec ne bloque pas l'import (elle pourra être ajoutée plus tard)
    wave = meta.duration ? peaksFromLocalMp4(file, meta.duration).then(encodePeaks).catch(() => null) : Promise.resolve(null);
  }

  onStep?.(`Envoi du fichier (${KIND_LABEL[kind] || 'fichier'}, ${fmtGB(file.size)})…`);
  await uploadFile(hosting, key, file, { onProgress, signal, contentType: kind === 'image' && /\.svg$/i.test(file.name) ? 'image/svg+xml' : file.type });
  if (thumbBlob) {
    await uploadFile(hosting, `${key}.jpg`, thumbBlob, { contentType: 'image/jpeg' }).catch(() => { thumbBlob = null; });
    if (thumbBlob) thumb = publicUrl(hosting, `${key}.jpg`);
  }
  if (kind === 'video') { onStep?.('Calcul de l’onde sonore…'); peaks = await wave; }

  return { source: 'file', videoId: key, url, thumb, size: file.size, kind, name: file.name, peaks };
}

// clés à effacer du stockage pour une version importée (fichier + vignette)
export const keysOf = (v) => (v.source === 'file' && v.videoId ? [v.videoId, `${v.videoId}.jpg`] : []);
