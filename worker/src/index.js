// Notifications push de Nocturnz Review (Cloudflare Worker, offre gratuite).
//  - POST /subscribe   : un hôte connecté (jeton Firebase) enregistre l'appareil qui doit recevoir ses notifications
//  - POST /unsubscribe : il retire un appareil
//  - POST /notify      : après un commentaire ou un avis, le navigateur du client prévient le serveur ;
//                        le serveur relit le commentaire dans Firestore (jamais le texte envoyé par le client),
//                        retrouve le propriétaire de la review et lui envoie la notification.
// Aucune donnée n'est gardée ici à part les abonnements (KV) et une trace anti-doublon de 24 h.
import { buildPushPayload } from '@block65/webcrypto-web-push';

const PROJECT = 'nocturnz-review';
const ORIGINS = ['https://nocturnz-review.web.app', 'https://nocturnz-review.firebaseapp.com', 'https://review.nocturnz.xyz', 'http://localhost:3100'];
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const FRESH_MS = 10 * 60_000; // on ne notifie que des commentaires / avis de moins de 10 min

const cors = (req) => {
  const o = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};
const json = (req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } });

/* ───────── Jeton Firebase (vérifié avec les clés publiques de Google, aucun secret) ───────── */
let jwks = null, jwksAt = 0;
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
async function verifyIdToken(token) {
  const [h, p, sig] = String(token || '').split('.');
  if (!sig) throw new Error('jeton absent');
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(b64u(h)));
    claims = JSON.parse(new TextDecoder().decode(b64u(p)));
  } catch { throw new Error('jeton illisible'); }
  const now = Date.now() / 1000;
  if (claims.aud !== PROJECT || claims.iss !== `https://securetoken.google.com/${PROJECT}` || !(claims.exp > now) || !claims.sub) throw new Error('jeton refusé');
  if (!jwks || Date.now() - jwksAt > 3600_000) {
    jwks = (await (await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')).json()).keys;
    jwksAt = Date.now();
  }
  const jwk = jwks.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('clé inconnue');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('signature invalide');
  return claims.sub;
}

/* ───────── Firestore (lecture REST, avec les mêmes droits que la personne qui commente) ───────── */
const val = (f) => (f == null ? null : f.stringValue ?? (f.integerValue != null ? Number(f.integerValue) : f.doubleValue ?? f.booleanValue ?? f.timestampValue ?? (f.nullValue !== undefined ? null : null)));
async function readDoc(path, token) {
  const r = await fetch(`${FS}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) return null;
  const d = await r.json();
  return Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, val(v)]));
}

const tc = (t) => { const s = Math.max(0, Math.floor(Number(t) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/* ───────── Abonnements ───────── */
const subsKey = (uid) => `subs:${uid}`;
async function getSubs(env, uid) { return (await env.PUSH.get(subsKey(uid), 'json')) || []; }

async function sendAll(env, uid, data) {
  const subs = await getSubs(env, uid);
  if (!subs.length) return 0;
  const vapid = { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const keep = [];
  let sent = 0;
  for (const sub of subs) {
    try {
      const payload = await buildPushPayload({ data: JSON.stringify(data), options: { ttl: 24 * 3600, urgency: 'high', topic: data.tag?.slice(0, 32) } }, sub, vapid);
      const res = await fetch(sub.endpoint, payload);
      if (res.status === 404 || res.status === 410) continue; // appareil désabonné : on l'oublie
      keep.push(sub);
      if (res.ok) sent++;
    } catch { keep.push(sub); }
  }
  if (keep.length !== subs.length) await env.PUSH.put(subsKey(uid), JSON.stringify(keep));
  return sent;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    try {
      if (url.pathname === '/vapid' && req.method === 'GET') return json(req, { publicKey: env.VAPID_PUBLIC_KEY });

      if (url.pathname === '/subscribe' || url.pathname === '/unsubscribe') {
        if (req.method !== 'POST') return json(req, { error: 'méthode' }, 405);
        const uid = await verifyIdToken((req.headers.get('Authorization') || '').replace(/^Bearer /, ''));
        const { subscription, endpoint } = await req.json();
        let subs = await getSubs(env, uid);
        if (url.pathname === '/subscribe') {
          if (!subscription?.endpoint?.startsWith('https://') || !subscription.keys?.p256dh || !subscription.keys?.auth) return json(req, { error: 'abonnement invalide' }, 400);
          subs = [subscription, ...subs.filter((s) => s.endpoint !== subscription.endpoint)].slice(0, 10);
        } else subs = subs.filter((s) => s.endpoint !== endpoint);
        await env.PUSH.put(subsKey(uid), JSON.stringify(subs));
        return json(req, { ok: true, devices: subs.length });
      }

      if (url.pathname === '/notify' && req.method === 'POST') {
        const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '') || null; // invité connecté (review sur invitation)
        const { aid, n, cid, kind } = await req.json();
        if (!/^[\w-]{10,40}$/.test(aid || '') || !/^\d{1,4}$/.test(String(n))) return json(req, { error: 'requête invalide' }, 400);
        const asset = await readDoc(`assets/${aid}`, token);
        if (!asset?.owner) return json(req, { error: 'review inaccessible' }, 403);
        const vpath = `assets/${aid}/versions/${n}`;
        let data, seen;
        if (kind === 'status') {
          const v = await readDoc(vpath, token);
          if (!v?.status || !(Date.now() - Number(v.statusAt) < FRESH_MS)) return json(req, { ok: true, skipped: 'ancien' });
          seen = `seen:st:${aid}:${n}:${v.statusAt}`;
          data = {
            title: asset.title || 'Review',
            body: `${v.statusBy || 'Le client'} ${v.status === 'approved' ? 'a validé' : 'demande des modifications sur'} la v${n}`,
            url: `/r/${aid}?v=${n}`, tag: `r-${aid}`,
          };
        } else {
          if (!/^[\w-]{10,40}$/.test(cid || '')) return json(req, { error: 'requête invalide' }, 400);
          const c = await readDoc(`${vpath}/comments/${cid}`, token);
          if (!c?.body || !(Date.now() - Date.parse(c.created) < FRESH_MS)) return json(req, { ok: true, skipped: 'ancien' });
          seen = `seen:c:${cid}`;
          const where = c.parentId ? 'a répondu' : c.tEnd != null ? `${tc(c.t)} → ${tc(c.tEnd)}` : `à ${tc(c.t)}`;
          data = { title: asset.title || 'Review', body: `${c.author} ${where} : ${clip(c.body, 160)}`, url: `/r/${aid}?v=${n}&c=${c.parentId || cid}`, tag: `r-${aid}` };
        }
        if (await env.PUSH.get(seen)) return json(req, { ok: true, skipped: 'déjà envoyé' });
        await env.PUSH.put(seen, '1', { expirationTtl: 86400 });
        const sent = await sendAll(env, asset.owner, data);
        return json(req, { ok: true, sent });
      }
      return json(req, { error: 'introuvable' }, 404);
    } catch (e) {
      return json(req, { error: e.message || 'erreur' }, /jeton|signature|clé/.test(e.message) ? 401 : 500);
    }
  },
};
