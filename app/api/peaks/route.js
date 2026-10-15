import { setPeaks, getVideo } from '@/lib/db';
import { isAdmin } from '@/lib/auth';

// l'onde sonore est calculée dans le navigateur de l'admin puis partagée avec les invités
export async function POST(req) {
  if (!(await isAdmin())) return Response.json({ error: 'forbidden' }, { status: 403 });
  const { token, peaks } = await req.json();
  if (typeof token !== 'string' || !getVideo(token) || typeof peaks !== 'string' || peaks.length > 80000 || !/^(2:)?[A-Za-z0-9+/=]+$/.test(peaks)) return Response.json({ error: 'bad' }, { status: 400 });
  setPeaks(token, peaks);
  return Response.json({ ok: true });
}
