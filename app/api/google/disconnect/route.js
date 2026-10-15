import { isAdmin } from '@/lib/auth';
import { clearGoogleAuth } from '@/lib/db';

export async function POST() {
  if (!(await isAdmin())) return Response.json({ error: 'forbidden' }, { status: 403 });
  clearGoogleAuth();
  return Response.json({ ok: true });
}
