import { firebaseConfig } from './firebaseConfig';

export const parseYouTubeId = (input) => {
  try {
    const u = new URL(String(input).trim());
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/)?.[2];
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
};

export const parseDriveId = (input) => {
  const s = String(input).trim();
  const m = s.match(/\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{20,})$/);
  return m?.[1] ?? null;
};

// Un lien → { source, videoId } ou null. YouTube d'abord (un id Drive est plus long).
export const parseLink = (link) => {
  const yt = parseYouTubeId(link);
  if (yt) return { source: 'youtube', videoId: yt };
  const drive = parseDriveId(link);
  return drive ? { source: 'drive', videoId: drive } : null;
};

// oEmbed répond 200 pour une vidéo lisible en intégration, 401/403/404 sinon. Si le navigateur ne peut pas
// interroger (réseau, CORS), on n'invente pas un refus : on laisse passer, le lecteur le dira.
export async function checkYouTube(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    if (r.ok) return { ok: true, title: (await r.json()).title || null };
    if ([401, 403, 404].includes(r.status)) return { ok: false };
  } catch {}
  return { ok: true, title: null };
}

// Fichier Drive partagé « avec le lien » : lu directement par le navigateur, avec une clé API restreinte à ce site.
// Par défaut, la clé du navigateur du projet Firebase (à restreindre à l'API Drive, voir README).
const DRIVE_KEY = import.meta.env.VITE_DRIVE_API_KEY || firebaseConfig.apiKey;
export const driveUrl = (id) => `https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${DRIVE_KEY}`;
export const videoUrl = (source, videoId) => (source === 'drive' ? driveUrl(videoId) : null);

// Métadonnées d'un fichier Drive public (taille, durée) : une petite requête JSON, sans télécharger la vidéo.
export async function driveMeta(id) {
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,size,videoMediaMetadata&key=${DRIVE_KEY}`);
    if (!r.ok) return null;
    const j = await r.json();
    return { name: j.name, size: Number(j.size) || null };
  } catch { return null; }
}
