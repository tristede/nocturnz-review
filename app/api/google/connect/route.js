import { randomBytes } from 'node:crypto';
import { isAdmin } from '@/lib/auth';
import { googleConfigured, baseUrl, SCOPE } from '@/lib/google';

export async function GET(req) {
  if (!(await isAdmin())) return new Response('forbidden', { status: 403 });
  if (!googleConfigured()) return new Response('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants dans .env.local', { status: 500 });
  const state = randomBytes(16).toString('hex');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${baseUrl(req)}/api/google/callback`,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Set-Cookie': `g_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600` } });
}
