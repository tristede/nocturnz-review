import { setStatus } from '@/lib/db';
import { requireVideo } from '@/lib/access';

// validation d'une version : 'approved' (validée), 'changes' (modifications demandées) ou null (annule)
export async function POST(req) {
  const { token, status, author } = await req.json();
  const { video, error } = await requireVideo(token);
  if (error) return error;
  if (status !== null && !['approved', 'changes'].includes(status)) return Response.json({ error: 'bad status' }, { status: 400 });
  if (status && !String(author || '').trim()) return Response.json({ error: 'author required' }, { status: 400 });
  setStatus(video.id, status, String(author || '').trim().slice(0, 60));
  return Response.json({ ok: true });
}
