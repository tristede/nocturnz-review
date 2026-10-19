// Mises à jour automatiques : une webapp ajoutée à l'écran d'accueil (surtout sur iPhone) est « réveillée »
// sans être rechargée et garde l'ancienne version. Au retour au premier plan (et toutes les 10 min),
// on compare le numéro de build avec /version.json et on recharge dès que rien n'est en cours.
/* global __BUILD__ */
let last = 0;

function busy() {
  const a = document.activeElement;
  if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return true;
  return [...document.querySelectorAll('video,audio')].some((m) => !m.paused && !m.ended);
}

function reloadWhenIdle() {
  if (!busy()) { location.reload(); return; }
  const t = setInterval(() => { if (!busy()) { clearInterval(t); location.reload(); } }, 3000);
}

async function check() {
  if (Date.now() - last < 15000) return;
  last = Date.now();
  try {
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    const r = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const { v } = await r.json();
    if (v && v !== __BUILD__) reloadWhenIdle();
  } catch (_) { /* hors ligne : on réessaiera */ }
}

export function autoUpdate() {
  if (!import.meta.env.PROD) return;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  setInterval(check, 10 * 60 * 1000);
}
