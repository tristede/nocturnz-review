// Tests des règles Firestore sur l'émulateur : npm run test:rules
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, serverTimestamp, Timestamp } from 'firebase/firestore';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({
  projectId: 'nocturnz-review-test',
  firestore: { host, port: Number(port), rules: readFileSync('firestore.rules', 'utf8') },
});

const past = Timestamp.fromMillis(Date.now() - 86_400_000), future = Timestamp.fromMillis(Date.now() + 86_400_000);
const asset = (over = {}) => ({ title: 'Clip', owner: 'hostUid', created: Timestamp.now(), expiresAt: future, revoked: false, access: 'link', invited: [], ...over });
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'config/hosts'), { emails: ['host@x.test'] });
  await setDoc(doc(db, 'assets/LINK'), asset());
  await setDoc(doc(db, 'assets/NOEXP'), asset({ expiresAt: null }));
  await setDoc(doc(db, 'assets/REV'), asset({ revoked: true }));
  await setDoc(doc(db, 'assets/EXP'), asset({ expiresAt: past }));
  await setDoc(doc(db, 'assets/INV'), asset({ access: 'invite', invited: ['friend@x.test'] }));
  await setDoc(doc(db, 'assets/LINK/versions/1'), { n: 1, source: 'youtube', videoId: 'abc', fps: null, peaks: null, status: null, statusBy: null, statusAt: null });
  await setDoc(doc(db, 'assets/INV/versions/1'), { n: 1, source: 'youtube', videoId: 'abc', fps: null, peaks: null, status: null, statusBy: null, statusAt: null });
  await setDoc(doc(db, 'assets/LINK/versions/1/comments/c1'), { author: 'Léa', body: 'ok', t: 1, tEnd: null, x: null, y: null, shapes: null, parentId: null, resolved: false, created: Timestamp.now() });
});

const user = (uid, email, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const hostDb = user('hostUid', 'host@x.test');
const otherHostDb = user('u2', 'other@x.test');            // connecté mais pas dans la liste des hôtes
const friendDb = user('friendUid', 'friend@x.test');       // invité
const friendUnverified = user('friendUid', 'friend@x.test', false);
const strangerDb = user('strangerUid', 'stranger@x.test'); // connecté, non invité
const guestDb = env.unauthenticatedContext().firestore();   // personne

const comment = (over = {}) => ({ author: 'Léa', body: 'trop tard ici', t: 1.5, tEnd: null, x: null, y: null, shapes: null, parentId: null, resolved: false, created: serverTimestamp(), ...over });
let fails = 0, total = 0;
async function check(name, p) {
  total++;
  try { await p; console.log('  ✓', name); } catch (e) { fails++; console.log('  ✗', name, '\n     ', String(e.message).split('\n')[0]); }
}

console.log('Hôtes');
await check('un hôte lit ses propres reviews (liste filtrée par owner)', assertSucceeds(getDocs(query(collection(hostDb, 'assets'), where('owner', '==', 'hostUid')))));
await check('un hôte crée une review à son nom', assertSucceeds(setDoc(doc(hostDb, 'assets/NEW'), { title: 'Nouveau', owner: 'hostUid', created: serverTimestamp(), expiresAt: future, revoked: false, access: 'link', invited: [] })));
await check('un hôte ne peut pas créer une review au nom d\'un autre', assertFails(setDoc(doc(hostDb, 'assets/NEW2'), asset({ owner: 'someoneElse' }))));
await check('un compte connecté hors liste ne peut pas créer de review', assertFails(setDoc(doc(otherHostDb, 'assets/X'), asset({ owner: 'u2' }))));
await check('un invité sans compte ne peut pas créer de review', assertFails(setDoc(doc(guestDb, 'assets/X'), asset({ owner: 'x' }))));
await check('un hôte ajoute une version', assertSucceeds(setDoc(doc(hostDb, 'assets/LINK/versions/2'), { n: 2, source: 'youtube', videoId: 'def', fps: null, peaks: null, status: null, statusBy: null, statusAt: null })));
await check('un hôte règle fps et onde', assertSucceeds(updateDoc(doc(hostDb, 'assets/LINK/versions/1'), { fps: 25, peaks: 'AAAA' })));
await check('un hôte lit une review désactivée ou expirée (aperçu)', assertSucceeds(Promise.all([getDoc(doc(hostDb, 'assets/REV')), getDoc(doc(hostDb, 'assets/EXP'))])));
await check('un autre compte ne peut pas ouvrir une review désactivée qui n\'est pas la sienne', assertFails(getDoc(doc(otherHostDb, 'assets/REV'))));
await check('un lien secret reste lisible par tout compte connecté qui le connaît (comme pour un invité)', assertSucceeds(getDoc(doc(otherHostDb, 'assets/LINK'))));
await check('personne ne lit config/hosts', assertFails(getDoc(doc(hostDb, 'config/hosts'))));

console.log('Énumération');
await check('un invité ne peut pas lister les reviews', assertFails(getDocs(collection(guestDb, 'assets'))));
await check('une requête sans filtre owner est refusée même pour un hôte', assertFails(getDocs(collection(hostDb, 'assets'))));
await check('un hôte ne peut pas lister les reviews d\'un autre via owner', assertFails(getDocs(query(collection(otherHostDb, 'assets'), where('owner', '==', 'hostUid')))));

console.log('Lien secret');
await check('un invité lit une review active par son lien', assertSucceeds(getDoc(doc(guestDb, 'assets/LINK'))));
await check('…et ses versions', assertSucceeds(getDocs(collection(guestDb, 'assets/LINK/versions'))));
await check('…sans expiration non plus', assertSucceeds(getDoc(doc(guestDb, 'assets/NOEXP'))));
await check('une review désactivée est refusée', assertFails(getDoc(doc(guestDb, 'assets/REV'))));
await check('une review expirée est refusée', assertFails(getDoc(doc(guestDb, 'assets/EXP'))));

console.log('Sur invitation');
await check('sans compte : refusé', assertFails(getDoc(doc(guestDb, 'assets/INV'))));
await check('connecté mais non invité : refusé', assertFails(getDoc(doc(strangerDb, 'assets/INV'))));
await check('invité avec e-mail non vérifié : refusé', assertFails(getDoc(doc(friendUnverified, 'assets/INV'))));
await check('invité avec e-mail vérifié : autorisé', assertSucceeds(getDoc(doc(friendDb, 'assets/INV'))));
await check('invité : lit les versions', assertSucceeds(getDocs(collection(friendDb, 'assets/INV/versions'))));
await check('non invité : ne lit pas les versions', assertFails(getDocs(collection(strangerDb, 'assets/INV/versions'))));

console.log('Commentaires');
await check('un invité commente', assertSucceeds(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/n1'), comment())));
await check('…avec un dessin et une plage', assertSucceeds(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/n2'), comment({ tEnd: 3, x: 0.4, y: 0.6, shapes: '[{"t":"pen"}]' }))));
await check('…une réponse', assertSucceeds(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/n3'), comment({ parentId: 'n1' }))));
await check('un commentaire sur une review désactivée est refusé', assertFails(setDoc(doc(guestDb, 'assets/REV/versions/1/comments/z'), comment())));
await check('un commentaire sur une review invitation sans compte est refusé', assertFails(setDoc(doc(guestDb, 'assets/INV/versions/1/comments/z'), comment())));
await check('un invité listé commente sur invitation', assertSucceeds(setDoc(doc(friendDb, 'assets/INV/versions/1/comments/z'), comment())));
await check('auteur trop long : refusé', assertFails(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/bad1'), comment({ author: 'x'.repeat(61) }))));
await check('corps vide : refusé', assertFails(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/bad2'), comment({ body: '' }))));
await check('champ en trop : refusé', assertFails(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/bad3'), comment({ admin: true }))));
await check('date imposée par le client : refusée', assertFails(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/bad4'), comment({ created: Timestamp.fromMillis(1) }))));
await check('commentaire déjà « résolu » à la création : refusé', assertFails(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/bad5'), comment({ resolved: true }))));
await check('plage incohérente (fin avant début) : refusée', assertFails(setDoc(doc(guestDb, 'assets/LINK/versions/1/comments/bad6'), comment({ t: 5, tEnd: 2 }))));
await check('un invité résout un commentaire', assertSucceeds(updateDoc(doc(guestDb, 'assets/LINK/versions/1/comments/c1'), { resolved: true })));
await check('un invité ne peut pas réécrire le texte d\'un commentaire', assertFails(updateDoc(doc(guestDb, 'assets/LINK/versions/1/comments/c1'), { body: 'piraté' })));
await check('un invité ne supprime pas de commentaire', assertFails(deleteDoc(doc(guestDb, 'assets/LINK/versions/1/comments/c1'))));
await check('l\'hôte supprime un commentaire', assertSucceeds(deleteDoc(doc(hostDb, 'assets/LINK/versions/1/comments/n3'))));

console.log('Validation de version');
await check('un invité valide une version', assertSucceeds(updateDoc(doc(guestDb, 'assets/LINK/versions/1'), { status: 'approved', statusBy: 'Léa', statusAt: 123 })));
await check('…ou demande des modifications', assertSucceeds(updateDoc(doc(guestDb, 'assets/LINK/versions/1'), { status: 'changes', statusBy: 'Léa', statusAt: 124 })));
await check('un invité annule la validation', assertSucceeds(updateDoc(doc(guestDb, 'assets/LINK/versions/1'), { status: null, statusBy: null, statusAt: null })));
await check('statut inventé : refusé', assertFails(updateDoc(doc(guestDb, 'assets/LINK/versions/1'), { status: 'hacked', statusBy: 'x', statusAt: 1 })));
await check('un invité ne touche pas au fps ni à l\'onde', assertFails(updateDoc(doc(guestDb, 'assets/LINK/versions/1'), { fps: 60 })));
await check('un invité ne crée pas de version', assertFails(setDoc(doc(guestDb, 'assets/LINK/versions/9'), { n: 9, source: 'youtube', videoId: 'x', fps: null, peaks: null, status: null, statusBy: null, statusAt: null })));

console.log('Gestion du partage');
await check('l\'hôte désactive puis réactive', assertSucceeds(updateDoc(doc(hostDb, 'assets/NOEXP'), { revoked: true })));
await check('l\'hôte passe une review en invitation', assertSucceeds(updateDoc(doc(hostDb, 'assets/LINK'), { access: 'invite', invited: ['friend@x.test'] })));
await check('un invité ne modifie pas le partage', assertFails(updateDoc(doc(guestDb, 'assets/LINK'), { revoked: true })));
await check('un invité ne supprime pas la review', assertFails(deleteDoc(doc(guestDb, 'assets/LINK'))));
await check('l\'hôte ne peut pas céder la review à un autre propriétaire', assertFails(updateDoc(doc(hostDb, 'assets/LINK'), { owner: 'u2' })));

await env.cleanup();
console.log(`\n${total - fails}/${total} réussis`);
process.exit(fails ? 1 : 0);
