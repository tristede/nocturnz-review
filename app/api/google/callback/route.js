import { isAdmin } from '@/lib/auth';
import { baseUrl, tokenRequest } from '@/lib/google';
import { saveGoogleAuth } from '@/lib/db';

export async function GET(req) {
  if (!(await isAdmin())) return new Response('forbidden', { status: 403 });
  const u = new URL(req.url);
  const expected = req.headers.get('cookie')?.match(/g_state=([a-f0-9]+)/)?.[1];
  if (u.searchParams.get('error')) return new Response(null, { status: 302, headers: { Location: '/?google=refused' } });
  if (!expected || u.searchParams.get('state') !== expected) return new Response('state invalide', { status: 400 });

  const { ok, data } = await tokenRequest({
    grant_type: 'authorization_code',
    code: u.searchParams.get('code'),
    redirect_uri: `${baseUrl(req)}/api/google/callback`,
  });
  if (!ok || !data.refresh_token) return new Response(null, { status: 302, headers: { Location: '/?google=error' } });
  saveGoogleAuth({ refresh: data.refresh_token, access: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return new Response(null, { status: 302, headers: { Location: '/?google=ok', 'Set-Cookie': 'g_state=; Path=/; Max-Age=0' } });
}
