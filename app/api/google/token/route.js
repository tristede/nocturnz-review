import { isAdmin } from '@/lib/auth';
import { getAccessToken } from '@/lib/google';

export const dynamic = 'force-dynamic';

// pour le sélecteur de fichiers Drive côté navigateur (admin uniquement)
export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: 'forbidden' }, { status: 403 });
  const token = await getAccessToken();
  if (!token) return Response.json({ error: 'not_connected' }, { status: 401 });
  return Response.json({
    token,
    apiKey: process.env.GOOGLE_API_KEY || '',
    appId: process.env.GOOGLE_APP_ID || '',
  });
}
