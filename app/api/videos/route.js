import { isAdmin } from '@/lib/auth';
import { addAsset, addVersion } from '@/lib/db';

// ajout d'une vidéo choisie dans le sélecteur Drive (accès OAuth, fichier non public)
export async function POST(req) {
  if (!(await isAdmin())) return Response.json({ error: 'forbidden' }, { status: 403 });
  const { fileId, name, assetId } = await req.json();
  if (typeof fileId !== 'string' || !/^[\w-]{10,}$/.test(fileId)) return Response.json({ error: 'bad id' }, { status: 400 });
  const title = String(name || 'Sans titre').replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 120);
  if (assetId) {
    const n = addVersion(Number(assetId), fileId, 'oauth');
    return n ? Response.json({ version: n }) : Response.json({ error: 'not found' }, { status: 404 });
  }
  return Response.json({ token: addAsset(title, fileId, 'oauth') });
}
