import { cookies } from 'next/headers';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isAdmin } from '@/lib/auth';
import { getAssetById, getVideo } from '@/lib/db';

export const hashPassword = (pw) => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(String(pw), salt, 32).toString('hex')}`;
};

export const verifyPassword = (asset, pw) => {
  if (!asset.password) return true;
  const [salt, hash] = asset.password.split(':');
  const a = Buffer.from(hash, 'hex'), b = scryptSync(String(pw), salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
};

// le cookie dépend du lien et du mot de passe : les changer déconnecte les invités déjà entrés
const sig = (asset) => createHash('sha256').update(`rv:${asset.id}:${asset.token}:${asset.password || ''}:${process.env.ADMIN_PASSWORD || ''}`).digest('hex');
export const unlockCookie = (asset) => ({ name: `rv_${asset.id}`, value: sig(asset), options: { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 } });

// 'ok' | 'revoked' | 'expired' | 'password'  (l'admin passe toujours)
export async function accessState(asset) {
  if (await isAdmin()) return 'ok';
  if (asset.revoked) return 'revoked';
  if (asset.expires_at && asset.expires_at < Date.now()) return 'expired';
  if (asset.password && (await cookies()).get(`rv_${asset.id}`)?.value !== sig(asset)) return 'password';
  return 'ok';
}

// pour les routes API : { video, asset } si l'accès est autorisé, sinon { error: Response }
export async function requireVideo(versionToken) {
  const video = typeof versionToken === 'string' ? getVideo(versionToken) : null;
  const asset = video && getAssetById(video.asset_id);
  if (!video || !asset) return { error: Response.json({ error: 'not found' }, { status: 404 }) };
  const st = await accessState(asset);
  if (st !== 'ok') return { error: Response.json({ error: st }, { status: 403 }) };
  return { video, asset };
}
