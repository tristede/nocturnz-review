// Import d'un montage exporté en XML (Premiere : Fichier › Exporter › Final Cut Pro XML ; Resolve : FCP 7 XML).
// Purement visuel : on garde les clips des pistes vidéo (nom, couleur de libellé) et les marqueurs de la séquence.
// Format enregistré (compact) : { v: 1, name, tracks: [[[début, fin, nom, couleur], …], …] (V1 d'abord, pistes vides gardées),
// markers: [[t, fin|null, nom, couleur]], hide: ['V2', 'M', …] (pistes écartées par l'hôte ; 'M' = marqueurs) }

// couleurs de libellé Premiere (approximatives) ; inconnues → gris
export const LABEL_COLORS = {
  violet: '#a58fe0', iris: '#8c8cf5', caribbean: '#2fc3a5', lavender: '#e48fe4', cerulean: '#3aa0e8',
  forest: '#4f9a4f', rose: '#f0638f', mango: '#f3a33c', purple: '#9b59c6', blue: '#4a6fe0',
  teal: '#2aa7a7', magenta: '#d64fb4', tan: '#c9a77c', green: '#5fbf5f', brown: '#9c6b46',
  yellow: '#e6cf3c', red: '#e5534b', orange: '#f08a3c', cyan: '#3cc8e6', pink: '#f08fb8',
};
export const colorOf = (c) => LABEL_COLORS[String(c || '').toLowerCase()] || '#7d7a92';

const kids = (el, tag) => (el ? [...el.children].filter((c) => c.tagName === tag) : []);
const kid = (el, tag) => kids(el, tag)[0] || null;
const txt = (el, tag) => kid(el, tag)?.textContent.trim() ?? '';
const num = (el, tag) => { const n = Number(txt(el, tag)); return Number.isFinite(n) ? n : null; };

// images/s d'un <rate> : timebase, divisé par 1,001 si ntsc
const rateOf = (el) => {
  const r = kid(el, 'rate');
  const base = num(r, 'timebase');
  if (!base) return null;
  return txt(r, 'ntsc').toUpperCase() === 'TRUE' ? base * 1000 / 1001 : base;
};

const labelOf = (el) => { const l = kid(el, 'labels'); return txt(l, 'label2') || txt(l, 'label') || ''; };

function parseSequence(seq) {
  const fps = rateOf(seq) || 25;
  // si la séquence a un point d'entrée (export In/Out), la vidéo commence là
  const seqIn = Math.max(0, num(seq, 'in') ?? 0);
  const sec = (f) => Math.round(((f - seqIn) / fps) * 1000) / 1000;
  const media = kid(seq, 'media');
  const tracks = kids(kid(media, 'video'), 'track').map((tr) => {
    const items = [...tr.children].filter((c) => c.tagName === 'clipitem' || c.tagName === 'transitionitem');
    const out = [];
    items.forEach((it, i) => {
      if (it.tagName !== 'clipitem' || txt(it, 'enabled').toUpperCase() === 'FALSE') return;
      let s = num(it, 'start'), e = num(it, 'end');
      // -1 = le bord du clip est au milieu d'une transition : on prend le bord de la transition voisine
      if (s == null || s < 0) s = num(items[i - 1], 'end') ?? num(it, 'in');
      if (e == null || e < 0) e = num(items[i + 1], 'start');
      if (s == null || e == null || e <= s) return;
      const a = sec(s), b = sec(e);
      if (b <= 0) return;
      out.push([Math.max(0, a), b, (txt(it, 'name') || '').slice(0, 80), labelOf(it)]);
    });
    return out;
  }); // les pistes vides restent : l'indice donne le numéro (0 = V1)
  const markers = kids(seq, 'marker').map((m) => {
    const a = num(m, 'in'), b = num(m, 'out');
    if (a == null || a < seqIn) return null;
    return [sec(a), b != null && b > a ? sec(b) : null, (txt(m, 'name') || txt(m, 'comment')).slice(0, 80), labelOf(m)];
  }).filter(Boolean);
  const duration = num(seq, 'duration');
  return { name: txt(seq, 'name').slice(0, 120), tracks, markers, len: duration ? duration / fps : 0 };
}

export function parseEditXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ce fichier n’est pas un XML valide.');
  const root = doc.documentElement;
  if (root.tagName === 'fcpxml') throw new Error('Ce fichier est un FCPXML (Final Cut Pro X). Exporte plutôt en « Final Cut Pro XML » (FCP 7) depuis Premiere ou Resolve.');
  if (root.tagName !== 'xmeml') throw new Error('Format non reconnu : exporte la séquence en « Final Cut Pro XML » depuis Premiere.');
  // séquences de premier niveau (pas celles imbriquées dans des clips) ; s'il y en a plusieurs, la plus longue
  const seqs = [...doc.getElementsByTagName('sequence')].filter((s) => !s.parentElement.closest('clipitem, file'));
  if (!seqs.length) throw new Error('Aucune séquence trouvée dans ce XML.');
  const best = seqs.map(parseSequence).sort((a, b) => b.len - a.len)[0];
  if (!best.tracks.some((t) => t.length) && !best.markers.length) throw new Error('Aucun clip ni marqueur dans cette séquence.');
  return { v: 1, name: best.name, tracks: best.tracks, markers: best.markers, hide: [] };
}

export const encodeEdit = (e) => JSON.stringify(e);
export const decodeEdit = (s) => { try { const e = s ? JSON.parse(s) : null; return e?.v === 1 ? e : null; } catch { return null; } };

// pistes réellement affichées, de haut en bas : marqueurs puis Vn … V1 (comme dans Premiere)
export function visibleRows(e) {
  const hide = new Set(e.hide || []);
  const rows = e.tracks.map((clips, i) => ({ key: `V${i + 1}`, clips })).filter((r) => r.clips.length && !hide.has(r.key)).reverse();
  return { markers: hide.has('M') ? [] : e.markers, rows };
}
