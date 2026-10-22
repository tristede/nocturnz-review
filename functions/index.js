// Aperçus de liens (WhatsApp, iMessage, Slack…) : ces services lisent la page sans exécuter l'app.
// Pour /r/<id> et /p/<id>, on renvoie la page de l'app avec, dans <head>, le titre du fichier et sa vignette.
// Une review réservée à des invités (accès « invite »), révoquée ou expirée garde un aperçu générique.
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();
const SITE = 'https://nocturnz-review.web.app';
const ICON = '/icon-512.png';
const KIND = { video: 'Vidéo', image: 'Image', pdf: 'PDF', psd: 'Photoshop', docx: 'Word', gdoc: 'Google Docs' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ms = (v) => (v?.toMillis ? v.toMillis() : null);
const shareable = (a) => a && !a.revoked && a.access !== 'invite' && !(ms(a.expiresAt) && ms(a.expiresAt) < Date.now());

// page de l'app (index.html du site), gardée quelques minutes en mémoire
let shell = null, shellAt = 0;
async function getShell() {
  if (!shell || Date.now() - shellAt > 300_000) {
    const r = await fetch(`${SITE}/index.html`);
    if (r.ok) { shell = await r.text(); shellAt = Date.now(); }
  }
  return shell;
}

const thumbOf = (v) => {
  if (!v) return null;
  if (v.thumb) return v.thumb;
  if (v.source === 'youtube') return `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`;
  if (v.source === 'drive') return `https://drive.google.com/thumbnail?id=${v.videoId}&sz=w1200`;
  return null;
};

async function previewFor(kind, id) {
  if (!/^[\w-]{6,64}$/.test(id)) return null;
  if (kind === 'r') {
    const snap = await db.doc(`assets/${id}`).get();
    const a = snap.data();
    if (!shareable(a)) return null;
    const vs = await db.collection(`assets/${id}/versions`).orderBy('n', 'desc').limit(1).get();
    const v = vs.docs[0]?.data();
    const bits = [v ? `v${v.n}` : null, KIND[v?.kind || 'video'], v?.name && v.name !== a.title ? v.name : null].filter(Boolean);
    return { title: a.title, description: `${bits.join(' · ')} — review sur Nocturnz`, image: thumbOf(v) };
  }
  const snap = await db.doc(`projects/${id}`).get();
  const p = snap.data();
  if (!shareable(p)) return null;
  const n = (await db.collection('assets').where('project', '==', id).count().get()).data().count;
  return { title: p.name, description: `Projet · ${n} élément${n > 1 ? 's' : ''} à revoir sur Nocturnz`, image: null };
}

export const og = onRequest({ region: 'europe-west1', memory: '256MiB', maxInstances: 5 }, async (req, res) => {
  const m = req.path.match(/^\/(r|p)\/([^/?#]+)/);
  let html = await getShell().catch(() => null);
  if (!html) return res.redirect(302, `${SITE}${req.originalUrl}`);
  let info = null;
  if (m) info = await previewFor(m[1], m[2]).catch(() => null);
  const host = req.get('x-forwarded-host') || req.get('host') || 'review.nocturnz.xyz';
  const url = `https://${host}${req.path}`;
  const title = info?.title || 'Nocturnz Review';
  const desc = info?.description || 'Review vidéo à l’image près';
  const image = info?.image || `https://${host}${ICON}`;
  const tags = [
    `<meta property="og:site_name" content="Nocturnz Review" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="${info?.image ? 'summary_large_image' : 'summary'}" />`,
  ].join('\n    ');
  html = html
    .replace(/<meta property="og:[^>]*>\s*/g, '').replace(/<meta name="twitter:[^>]*>\s*/g, '')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(info ? `${title} · Nocturnz Review` : title)}</title>\n    ${tags}`);
  res.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.type('html').send(html);
});
