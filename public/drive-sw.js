// Lecture des vidéos Drive par morceaux.
// Le lecteur vidéo demande « tout le fichier à partir de tel octet ». Sur un gros fichier très lu, Google refuse
// ces requêtes (« download quota exceeded ») alors qu'il accepte encore des morceaux. On découpe donc chaque
// demande du lecteur en un morceau de 64 Mo (≈ 25 s de 4K, pour rester sous la limite sans multiplier les requêtes) : le lecteur redemande la suite tout seul quand il en a besoin.
// Bonus : un saut dans la timeline ne lance plus un téléchargement de plusieurs Go aussitôt abandonné.
const CHUNK = 64 * 1024 * 1024;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // seulement la lecture vidéo/audio (pas le calcul de l'onde, qui lit le fichier à sa façon)
  if (req.destination !== 'video' && req.destination !== 'audio') return;
  const url = new URL(req.url);
  if (url.hostname !== 'www.googleapis.com' || !url.pathname.startsWith('/drive/v3/files/') || url.searchParams.get('alt') !== 'media') return;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  const start = m ? Number(m[1]) : 0;
  const askedEnd = m && m[2] ? Number(m[2]) : Infinity;
  const end = Math.min(askedEnd, start + CHUNK - 1);
  e.respondWith(fetch(req.url, { headers: { Range: `bytes=${start}-${end}` }, mode: 'cors', credentials: 'omit', signal: req.signal }));
});
