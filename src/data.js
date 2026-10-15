// Toute la communication avec Firestore passe ici. Les règles (firestore.rules) font foi pour la sécurité :
// rien de ce fichier n'est une barrière, c'est de la commodité.
import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, onSnapshot, query, serverTimestamp,
  setDoc, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';

const DAY = 86_400_000;
const ms = (v) => (v?.toMillis ? v.toMillis() : v ?? null);

// identifiant secret (128 bits) : c'est lui qui fait office de « lien secret »
export const newToken = () => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const toAsset = (d) => { const a = d.data(); return { id: d.id, ...a, created: ms(a.created), expiresAt: ms(a.expiresAt) }; };
const toVersion = (d) => ({ id: d.id, ...d.data() });
const newVersion = (n, source, videoId) => ({ n, source, videoId, fps: null, peaks: null, status: null, statusBy: null, statusAt: null });
const versionsRef = (aid) => collection(db, 'assets', aid, 'versions');
const commentsRef = (aid, n) => collection(db, 'assets', aid, 'versions', String(n), 'comments');

/* ───────── Lecture d'une review (invité ou hôte) ───────── */

// Lève l'erreur Firestore telle quelle (code « permission-denied » = introuvable, désactivée, expirée ou non invité)
export async function loadReview(aid) {
  const snap = await getDoc(doc(db, 'assets', aid));
  if (!snap.exists()) { const e = new Error('not-found'); e.code = 'not-found'; throw e; }
  const vs = await getDocs(versionsRef(aid));
  return { asset: toAsset(snap), versions: vs.docs.map(toVersion).sort((a, b) => a.n - b.n) };
}

const toComment = (d) => {
  const c = d.data();
  return {
    id: d.id, author: c.author, body: c.body, t: c.t, t_end: c.tEnd, x: c.x, y: c.y,
    shapes: c.shapes, parent_id: c.parentId, resolved: c.resolved ? 1 : 0,
    created_at: ms(c.created) ?? Date.now(),
  };
};

// Temps réel : les commentaires des autres apparaissent tout seuls, sans relancer de requête
export const subscribeComments = (aid, n, onData, onError) =>
  onSnapshot(commentsRef(aid, n), (snap) => onData(snap.docs.map(toComment).sort((a, b) => a.t - b.t || a.created_at - b.created_at)), onError);

const r4 = (v) => Math.round(v * 1e4) / 1e4;
export async function addComment(aid, n, c) {
  let shapes = c.shapes?.length ? JSON.stringify(c.shapes.slice(0, 30)) : null;
  if (shapes && shapes.length > 55000) shapes = null; // plafond des règles : mieux vaut perdre le dessin que le commentaire
  await addDoc(commentsRef(aid, n), {
    author: c.author.trim().slice(0, 60),
    body: c.body.trim().slice(0, 2000),
    t: c.t,
    tEnd: c.t_end != null && c.t_end > c.t ? c.t_end : null,
    x: c.x != null && c.y != null ? r4(c.x) : null,
    y: c.x != null && c.y != null ? r4(c.y) : null,
    shapes,
    parentId: c.parent_id ?? null,
    resolved: false,
    created: serverTimestamp(),
  });
}
export const setResolved = (aid, n, cid, resolved) => updateDoc(doc(commentsRef(aid, n), cid), { resolved: !!resolved });

export async function deleteComment(aid, n, cid) {
  const replies = await getDocs(query(commentsRef(aid, n), where('parentId', '==', cid)));
  const batch = writeBatch(db);
  replies.forEach((r) => batch.delete(r.ref));
  batch.delete(doc(commentsRef(aid, n), cid));
  await batch.commit();
}

export const setApproval = (aid, n, status, by) =>
  updateDoc(doc(versionsRef(aid), String(n)), { status: status || null, statusBy: status ? by : null, statusAt: status ? Date.now() : null });

// hôte : fps détecté, onde calculée
export const saveVersion = (aid, n, patch) => updateDoc(doc(versionsRef(aid), String(n)), patch);

/* ───────── Hôtes ───────── */

export async function listAssets(uid) {
  const snap = await getDocs(query(collection(db, 'assets'), where('owner', '==', uid)));
  const assets = await Promise.all(snap.docs.map(async (d) => {
    const a = toAsset(d);
    const vs = (await getDocs(versionsRef(d.id))).docs.map(toVersion).sort((x, y) => x.n - y.n);
    a.versions = await Promise.all(vs.map(async (v) => {
      const [all, open] = await Promise.all([
        getCountFromServer(commentsRef(d.id, v.n)),
        getCountFromServer(query(commentsRef(d.id, v.n), where('resolved', '==', false), where('parentId', '==', null))),
      ]);
      return { ...v, count: all.data().count, open: open.data().count };
    }));
    return a;
  }));
  return assets.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

export async function createAsset({ uid, title, source, videoId }) {
  const aid = newToken();
  await setDoc(doc(db, 'assets', aid), {
    title, owner: uid, created: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * DAY),
    revoked: false, access: 'link', invited: [],
  });
  await setDoc(doc(versionsRef(aid), '1'), newVersion(1, source, videoId));
  return aid;
}

export const addVersion = (aid, n, source, videoId) => setDoc(doc(versionsRef(aid), String(n)), newVersion(n, source, videoId));

// expiresAt : nombre de ms, null (jamais) ou undefined (inchangé)
export function updateShare(aid, { expiresAt, access, invited, revoked }) {
  const patch = {};
  if (expiresAt !== undefined) patch.expiresAt = expiresAt === null ? null : Timestamp.fromMillis(expiresAt);
  if (access) patch.access = access;
  if (invited) patch.invited = invited;
  if (revoked !== undefined) patch.revoked = revoked;
  return updateDoc(doc(db, 'assets', aid), patch);
}

export const parseEmails = (text) =>
  [...new Set(String(text).split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];

async function deleteAll(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}
export async function deleteAsset(aid) {
  const vs = await getDocs(versionsRef(aid));
  for (const v of vs.docs) {
    const cs = await getDocs(commentsRef(aid, v.id));
    await deleteAll(cs.docs.map((c) => c.ref));
  }
  await deleteAll([...vs.docs.map((v) => v.ref), doc(db, 'assets', aid)]);
}

/* ───────── Export des commentaires en markers pour Premiere Pro ───────── */

// timecode non-drop-frame : on compte les images au vrai fps, affichées sur la base nominale (29.97 → 30)
export async function exportMarkers(aid, version) {
  const fps = version.fps || 25, base = Math.round(fps), p = (n) => String(n).padStart(2, '0');
  const tc = (s) => {
    const f = Math.round(s * fps), sec = Math.floor(f / base);
    return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)}:${p(f % base)}`;
  };
  const all = (await getDocs(commentsRef(aid, version.n))).docs.map(toComment).sort((a, b) => a.t - b.t);
  const rows = all.filter((c) => !c.parent_id).map((c) => {
    const replies = all.filter((r) => r.parent_id === c.id).map((r) => ` | ${r.author}: ${r.body}`).join('');
    const out = c.t_end ?? c.t;
    return [c.author, (c.body + replies).replace(/\s+/g, ' '), tc(c.t), tc(out), tc(Math.max(0, out - c.t)), 'Comment'].join('\t');
  });
  return ['Marker Name\tDescription\tIn\tOut\tDuration\tMarker Type', ...rows].join('\n');
}
