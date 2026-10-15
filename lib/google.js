import { getGoogleAuth, saveGoogleAuth } from '@/lib/db';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const baseUrl = (req) => process.env.APP_URL || new URL(req.url).origin;

export async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  return { ok: r.ok, data: await r.json() };
}

// access token valide (rafraîchi à la demande avec le refresh token), ou null si Google n'est pas connecté
export async function getAccessToken() {
  const a = getGoogleAuth();
  if (!a || !googleConfigured()) return null;
  if (a.access_token && a.expires_at > Date.now() + 60_000) return a.access_token;
  const { ok, data } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: a.refresh_token });
  if (!ok) return null;
  saveGoogleAuth({ refresh: null, access: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
