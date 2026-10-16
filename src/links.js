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
// vignette publique (sans clé) ; peut échouer, l'image est alors simplement masquée
export const thumbUrl = (source, id) =>
  source === 'youtube' ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : `https://drive.google.com/thumbnail?id=${id}&sz=w480`;
// lecteur intégré de Google Drive (sans clé) : secours quand la lecture directe est refusée
export const driveEmbedUrl = (id) => `https://drive.google.com/file/d/${id}/preview`;
export const videoUrl = (source, videoId) => (source === 'drive' ? driveUrl(videoId) : null);

// Google Docs / Slides / Sheets / Drawings : Drive les exporte en PDF (fichiers de moins de 10 Mo)
export const driveExportUrl = (id) => `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application/pdf&key=${DRIVE_KEY}`;
// adresse du contenu d'une version selon son type
// (émulateur seulement : « local:fichier » lit tmp-test/, pour tester sans solliciter Drive)
export const fileUrl = (v) => (import.meta.env.VITE_EMULATORS && v.videoId.startsWith('local:') ? `/tmp-test/${v.videoId.slice(6)}`
  : v.kind === 'gdoc' ? driveExportUrl(v.videoId) : driveUrl(v.videoId));

// Métadonnées d'un fichier Drive public (nom, type, taille) : une petite requête JSON, sans télécharger le fichier.
// `denied` = Drive a répondu mais refuse (fichier privé, supprimé, lien faux) ; null = réseau.
export async function driveMeta(id) {
  try {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=name,size,mimeType,videoMediaMetadata&key=${DRIVE_KEY}`);
    if (!r.ok) return { denied: true, status: r.status };
    const j = await r.json();
    const ms = Number(j.videoMediaMetadata?.durationMillis) || null;
    return { name: j.name, size: Number(j.size) || null, mimeType: j.mimeType || '', duration: ms ? ms / 1000 : null };
  } catch { return null; }
}

// Type d'affichage d'un fichier : 'video' (lecteur vidéo) ou un type « page par page »
export function kindOf(mimeType = '', name = '') {
  const ext = (name.match(/\.(\w+)$/)?.[1] || '').toLowerCase();
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/') || ['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video';
  if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mimeType === 'image/vnd.adobe.photoshop' || ext === 'psd' || ext === 'psb') return 'psd';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return 'docx';
  if (mimeType === 'image/svg+xml' || ext === 'svg') return 'image';
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext)) return 'image';
  if (/^application\/vnd\.google-apps\.(document|presentation|spreadsheet|drawing)$/.test(mimeType)) return 'gdoc';
  return null;
}
export const KIND_LABEL = { video: 'Vidéo', image: 'Image', pdf: 'PDF', psd: 'Photoshop', docx: 'Word', gdoc: 'Google Docs' };
