// Notifications push : activation sur l'appareil de l'hôte, et signal envoyé au serveur après l'action d'un client.
// Le serveur (worker/) relit tout dans Firestore : ce fichier ne transmet que des identifiants.
import { auth } from './firebase';

export const PUSH_URL = import.meta.env.VITE_PUSH_URL || 'https://nocturnz-review-push.nocturnz-review.workers.dev';

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

// état de cet appareil : 'unsupported' | 'install' (iPhone : ajouter à l'écran d'accueil) | 'denied' | 'off' | 'on'
export async function pushState() {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function call(path, body) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch(`${PUSH_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Serveur de notifications : erreur ${r.status}`);
  return r.json();
}

export async function enablePush() {
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages de l’appareil.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await (await fetch(`${PUSH_URL}/vapid`)).json();
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await call('/subscribe', { subscription: sub.toJSON() });
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await call('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

// après un commentaire / une réponse / un avis d'un client : on prévient le serveur, sans jamais bloquer ni afficher d'erreur
export async function notifyHost(payload) {
  try {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null; // invité connecté (review sur invitation)
    await fetch(`${PUSH_URL}/notify`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(payload),
    });
  } catch {}
}
