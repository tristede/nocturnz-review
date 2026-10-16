// Fichiers « page par page » (image, SVG, PSD, PDF, Word, Google Docs) : chaque format est converti en pages
// de taille fixe, sur lesquelles on pose les commentaires et les dessins (positions en fraction de la page).
// Les bibliothèques ne sont chargées qu'à l'ouverture d'un fichier de ce type.
import { fileUrl } from './links';

const fail = (msg) => { throw new Error(msg); };

async function fetchFile(v) {
  let r;
  try { r = await fetch(fileUrl(v)); } catch { fail('Google Drive ne répond pas (blocage temporaire ou réseau). Réessaie dans quelques minutes.'); }
  if (!r.ok) {
    const reason = (await r.json().catch(() => null))?.error?.errors?.[0]?.reason;
    if (reason === 'downloadQuotaExceeded') fail('Google Drive bloque ce fichier pour aujourd’hui (trop téléchargé). Ça se débloque tout seul.');
    if (reason === 'exportSizeLimitExceeded') fail('Ce document Google est trop lourd pour être exporté (plus de 10 Mo).');
    fail(r.status === 404 ? 'Fichier introuvable : il a été supprimé, ou le partage « avec le lien » a été retiré.' : 'Google Drive refuse l’accès à ce fichier.');
  }
  return r;
}

const loadImg = (src) => new Promise((ok, ko) => {
  const im = new Image();
  im.onload = () => ok(im);
  im.onerror = () => ko(new Error('Image illisible.'));
  im.src = src;
});
const toUrl = (canvas) => new Promise((ok) => canvas.toBlob((b) => ok(URL.createObjectURL(b)), 'image/png'));

// Contenu HTML d'un document : on retire tout ce qui pourrait exécuter du code (scripts, liens javascript:, on…)
function sanitize(root) {
  root.querySelectorAll('script, iframe, object, embed, link, meta, form').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith('on') || ((a.name === 'href' || a.name === 'src' || a.name === 'xlink:href') && v.startsWith('javascript:'))) n.removeAttribute(a.name);
    }
    if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
  });
}

/**
 * Ouvre une version et renvoie { count, page(i), destroy }.
 * page(i) → { src, w, h } (une image) ou { el, w, h } (une page de document HTML).
 */
export async function openStill(v) {
  const urls = [];
  const keep = (u) => { urls.push(u); return u; };
  const done = () => urls.forEach((u) => URL.revokeObjectURL(u));

  if (v.kind === 'image') {
    // image et SVG passent par un blob : pas de dépendance au type annoncé par Drive, et un SVG reste inerte dans <img>
    const blob = await (await fetchFile(v)).blob();
    const isSvg = blob.type.includes('svg') || /^\s*<(\?xml|svg)/.test(await blob.slice(0, 200).text());
    const src = keep(URL.createObjectURL(isSvg ? new Blob([blob], { type: 'image/svg+xml' }) : blob));
    const im = await loadImg(src);
    const w = im.naturalWidth || 1200, h = im.naturalHeight || 900;
    return { count: 1, page: async () => ({ src, w, h }), destroy: done };
  }

  if (v.kind === 'psd') {
    const buf = await (await fetchFile(v)).arrayBuffer();
    const { readPsd } = await import('ag-psd');
    let psd;
    try { psd = readPsd(buf, { skipLayerImageData: true, skipThumbnail: true }); } catch { fail('Fichier Photoshop illisible.'); }
    if (!psd.canvas) fail('Ce PSD ne contient pas d’image d’aperçu : dans Photoshop, enregistre-le avec « Maximiser la compatibilité ».');
    const src = keep(await toUrl(psd.canvas));
    return { count: 1, page: async () => ({ src, w: psd.width, h: psd.height }), destroy: done };
  }

  if (v.kind === 'pdf' || v.kind === 'gdoc') {
    const data = await (await fetchFile(v)).arrayBuffer();
    const pdfjs = await import('pdfjs-dist');
    const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    let doc;
    try { doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise; } catch { fail('PDF illisible (protégé par mot de passe ou abîmé).'); }
    const cache = new Map();
    const page = (i) => {
      if (!cache.has(i)) {
        cache.set(i, (async () => {
          const p = await doc.getPage(i + 1);
          const base = p.getViewport({ scale: 1 });
          // rendu net jusqu'au zoom ×2 environ, sans dépasser ~2000 px de large (plus lent sinon)
          const vp = p.getViewport({ scale: Math.min(3, 2000 / base.width) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
          return { src: keep(await toUrl(canvas)), w: base.width, h: base.height };
        })());
      }
      return cache.get(i);
    };
    return { count: doc.numPages, page, destroy: () => { done(); doc.destroy(); } };
  }

  if (v.kind === 'docx') {
    const blob = await (await fetchFile(v)).blob();
    const { renderAsync } = await import('docx-preview');
    // rendu hors écran pour mesurer les pages ; Word enregistre ses propres sauts de page, docx-preview les reprend
    const host = Object.assign(document.createElement('div'), { className: 'docx-host' });
    const styles = document.createElement('div');
    document.body.append(host, styles);
    try {
      await renderAsync(blob, host, styles, {
        inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, ignoreWidth: false, ignoreHeight: false,
        renderHeaders: true, renderFooters: true, experimental: false, useBase64URL: true,
      });
    } catch { host.remove(); styles.remove(); fail('Document Word illisible (seul le format .docx est pris en charge).'); }
    sanitize(host);
    const pages = [...host.querySelectorAll('section.docx')];
    if (!pages.length) { host.remove(); styles.remove(); fail('Document Word vide.'); }
    // fichier sans format de page (créé hors de Word) : A4 avec les marges par défaut de Word
    pages.forEach((p) => { if (!p.style.width) Object.assign(p.style, { width: '794px', minHeight: '1123px', padding: '96px', boxSizing: 'border-box' }); });
    const sizes = pages.map((p) => ({ w: p.offsetWidth || 794, h: p.offsetHeight || 1123 }));
    return {
      count: pages.length,
      page: async (i) => ({ el: pages[i], ...sizes[i] }),
      destroy: () => { host.remove(); styles.remove(); },
    };
  }

  fail('Ce type de fichier n’est pas pris en charge.');
}
