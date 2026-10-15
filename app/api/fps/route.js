import { setFps, getVideo } from '@/lib/db';
import { isAdmin } from '@/lib/auth';

// l'admin enregistre le framerate détecté pour que les invités aient directement la bonne base
export async function POST(req) {
  if (!(await isAdmin())) return Response.json({ error: 'forbidden' }, { status: 403 });
  const { token, fps } = await req.json();
  if (typeof token !== 'string' || !getVideo(token) || typeof fps !== 'number' || !(fps >= 1 && fps <= 240)) return Response.json({ error: 'bad' }, { status: 400 });
  setFps(token, fps);
  return Response.json({ ok: true });
}
