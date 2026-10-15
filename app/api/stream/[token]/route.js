import { requireVideo } from '@/lib/access';
import { getAccessToken } from '@/lib/google';

export async function GET(req, { params }) {
  const { token } = await params;
  const { video: v, error } = await requireVideo(token);
  if (error) return error;
  if (v.source === 'youtube') return new Response('Source YouTube : lecteur intégré, pas de flux', { status: 400 });
  const headers = {};
  const range = req.headers.get('range');
  if (range) headers.Range = range;

  // vidéo choisie via le sélecteur Drive : accès OAuth du propriétaire ; sinon lien public + clé API
  let url = `https://www.googleapis.com/drive/v3/files/${v.drive_id}?alt=media`;
  if (v.source === 'oauth') {
    const access = await getAccessToken();
    if (!access) return new Response('Google Drive non connecté', { status: 503 });
    headers.Authorization = `Bearer ${access}`;
  } else {
    const key = process.env.GOOGLE_API_KEY;
    if (!key) return new Response('GOOGLE_API_KEY manquante', { status: 500 });
    url += `&key=${key}`;
  }
  const up = await fetch(url, { headers });
  if (!up.ok && up.status !== 206) return new Response(await up.text(), { status: up.status });

  const out = new Headers({ 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
  const ct = up.headers.get('content-type');
  out.set('Content-Type', ct && ct.startsWith('video/') ? ct : 'video/mp4');
  for (const h of ['content-length', 'content-range']) if (up.headers.get(h)) out.set(h, up.headers.get(h));
  return new Response(up.body, { status: up.status, headers: out });
}
