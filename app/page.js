import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { isAdmin } from '@/lib/auth';
import {
  listAssets, addAsset, addVersion, deleteAsset, setShare, setRevoked, regenToken,
  parseDriveId, parseYouTubeId, setFpsById, getGoogleAuth, getAssetById,
} from '@/lib/db';
import { hashPassword } from '@/lib/access';
import { googleConfigured } from '@/lib/google';
import PickDrive from './PickDrive';

const DAY = 86_400_000;
const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];

// lien collé → { source, id, title } ; redirige avec un message si le lien n'est pas exploitable
async function resolveLink(link, fallbackTitle) {
  const yt = parseYouTubeId(link);
  if (yt) {
    // oEmbed répond 200 pour une vidéo non répertoriée lisible en intégration, 401/404 sinon
    let info = null;
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`, { signal: AbortSignal.timeout(6000) });
      if (r.ok) info = await r.json();
    } catch {}
    if (!info) redirect('/?yt=unavailable');
    return { source: 'youtube', id: yt, title: fallbackTitle || info.title || 'Vidéo YouTube' };
  }
  const id = parseDriveId(link);
  if (!id) redirect('/?yt=badlink');
  return { source: 'public', id, title: fallbackTitle || 'Sans titre' };
}

async function add(fd) {
  'use server';
  const r = await resolveLink(String(fd.get('link')), String(fd.get('title')).trim());
  addAsset(r.title, r.id, r.source);
  revalidatePath('/');
}
async function addVersionAction(fd) {
  'use server';
  const r = await resolveLink(String(fd.get('link')), '');
  addVersion(Number(fd.get('assetId')), r.id, r.source);
  revalidatePath('/');
}
async function remove(fd) {
  'use server';
  deleteAsset(Number(fd.get('id')));
  revalidatePath('/');
}
async function saveShare(fd) {
  'use server';
  const id = Number(fd.get('id'));
  const a = getAssetById(id);
  if (!a) return;
  const e = String(fd.get('expires'));
  const expiresAt = e === 'keep' ? a.expires_at : e === 'never' ? null : Date.now() + Number(e) * DAY;
  const pw = String(fd.get('password') || '').trim();
  const password = fd.get('clearPassword') ? null : pw ? hashPassword(pw) : undefined;
  setShare(id, { expiresAt, password });
  revalidatePath('/');
}
async function toggleRevoked(fd) {
  'use server';
  setRevoked(Number(fd.get('id')), fd.get('revoked') === '1');
  revalidatePath('/');
}
async function newLink(fd) {
  'use server';
  regenToken(Number(fd.get('id')));
  revalidatePath('/');
}
async function saveFps(fd) {
  'use server';
  const v = Number(fd.get('fps'));
  setFpsById(Number(fd.get('id')), v > 0 ? v : null);
  revalidatePath('/');
}
async function logout() {
  'use server';
  (await cookies()).delete('admin');
  redirect('/login');
}

export const dynamic = 'force-dynamic';

const day = (t) => new Date(t).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
const shareLine = (a) => {
  if (a.revoked) return 'Lien désactivé';
  const parts = [a.expires_at ? (a.expires_at < Date.now() ? 'Expiré' : `Expire le ${day(a.expires_at)}`) : 'Sans expiration'];
  if (a.password) parts.push('mot de passe');
  return parts.join(' · ');
};

export default async function Home({ searchParams }) {
  const { google, yt } = await searchParams;
  if (!(await isAdmin())) redirect('/login');
  const assets = listAssets();
  const configured = googleConfigured();
  const connected = !!getGoogleAuth();
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') || 'http'}://${h.get('host')}`;

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 30 }}>
        <div className="brand" style={{ margin: 0 }}><i /> Review</div>
        <form action={logout}><button className="ghost sm">Se déconnecter</button></form>
      </div>
      <h1>Vos reviews</h1>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <PickDrive configured={configured} connected={connected} />
        {google === 'ok' && <span className="mut">Google Drive connecté.</span>}
        {(google === 'error' || google === 'refused') && <span className="mut">La connexion Google n’a pas abouti, réessaie.</span>}
        {yt === 'unavailable' && <span className="mut">Cette vidéo YouTube est introuvable, privée, ou l’intégration est désactivée par son propriétaire.</span>}
        {yt === 'badlink' && <span className="mut">Lien non reconnu : colle un lien Google Drive public ou un lien YouTube.</span>}
        <details className="adv" style={{ display: 'block' }}>
          <summary style={{ display: 'inline-flex' }}>Ajouter par lien (YouTube ou Drive public)</summary>
          <form action={add} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            <input name="title" placeholder="Titre (ex : Clip Zeph)" />
            <div className="row">
              <input name="link" placeholder="Lien YouTube (même non répertorié) ou lien Drive partagé" required />
              <button>Ajouter</button>
            </div>
          </form>
        </details>
      </div>

      {assets.map((a) => {
        const latest = a.versions[a.versions.length - 1];
        const open = a.versions.reduce((n, v) => n + v.open, 0);
        return (
          <div className="card" key={a.id}>
            <div className="asset-top">
              <div style={{ flex: '1 1 300px' }}>
                <span className="vtitle">{a.title}</span>
                {open > 0 && <span className="badge">{open} à traiter</span>}
                {latest.status === 'approved' && <span className="badge ok">Validée</span>}
                {latest.status === 'changes' && <span className="badge">Modifications demandées</span>}
                <div className="vchips">
                  {a.versions.map((v) => (
                    <a key={v.id} className="vchip" href={`/r/${a.token}?v=${v.version}`} title={`${v.n} commentaire(s)`}>
                      v{v.version}{v.status === 'approved' ? ' ✓' : ''}
                    </a>
                  ))}
                  <span className="mut">{latest.source === 'youtube' ? 'YouTube' : latest.source === 'oauth' ? 'Drive' : 'Drive (lien public)'}</span>
                </div>
                <div className="mut" style={{ marginTop: 6 }}>
                  {shareLine(a)} · <a href={`/r/${a.token}`}>{origin}/r/{a.token}</a>
                </div>
              </div>

              <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <details className="adv">
                  <summary>Partage</summary>
                  <div className="pop col">
                    <form action={saveShare} className="col-form">
                      <input type="hidden" name="id" value={a.id} />
                      <label className="lbl">Expiration du lien</label>
                      <select name="expires" defaultValue="keep" style={{ width: '100%' }}>
                        <option value="keep">Ne pas changer</option>
                        <option value="never">Jamais</option>
                        <option value="7">Dans 7 jours</option>
                        <option value="30">Dans 30 jours</option>
                        <option value="90">Dans 90 jours</option>
                      </select>
                      <label className="lbl">Mot de passe</label>
                      <input name="password" type="text" autoComplete="off" placeholder={a.password ? 'Nouveau mot de passe' : 'Aucun (optionnel)'} />
                      {a.password && <label className="check"><input type="checkbox" name="clearPassword" /> Retirer le mot de passe</label>}
                      <button>Enregistrer</button>
                    </form>
                    <div className="row" style={{ gap: 8 }}>
                      <form action={toggleRevoked}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="revoked" value={a.revoked ? '0' : '1'} />
                        <button className="ghost sm">{a.revoked ? 'Réactiver le lien' : 'Désactiver le lien'}</button>
                      </form>
                      <form action={newLink}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="ghost sm" title="L’ancien lien cesse de fonctionner">Nouveau lien</button>
                      </form>
                    </div>
                  </div>
                </details>

                <details className="adv">
                  <summary>Nouvelle version</summary>
                  <div className="pop col">
                    <span className="mut">Ajoute la v{latest.version + 1} : le lien de partage reste le même.</span>
                    <PickDrive configured={configured} connected={connected} assetId={a.id} compact />
                    <form action={addVersionAction} className="row">
                      <input type="hidden" name="assetId" value={a.id} />
                      <input name="link" placeholder="Lien YouTube ou Drive public" required />
                      <button className="sm">Ajouter</button>
                    </form>
                  </div>
                </details>

                <details className="adv">
                  <summary>Avancé</summary>
                  <form action={saveFps} className="pop">
                    <input type="hidden" name="id" value={latest.id} />
                    <select name="fps" defaultValue={latest.fps ?? ''} title={latest.source === 'youtube' ? 'YouTube ne donne pas le framerate : à régler à la main (25 par défaut)' : 'Images par seconde de la vidéo'}>
                      <option value="">{latest.source === 'youtube' ? 'Images/s : 25 (défaut)' : 'Images/s : auto'}</option>
                      {FPS_PRESETS.map((f) => <option key={f} value={f}>{f} images/s</option>)}
                    </select>
                    <button className="ghost sm">OK</button>
                    <span className="mut" style={{ fontSize: 12 }}>v{latest.version}</span>
                  </form>
                </details>

                <a href={`/api/export/${latest.token}`}><button className="ghost sm" title={`Markers de la v${latest.version}`}>Export Premiere</button></a>
                <form action={remove}><input type="hidden" name="id" value={a.id} /><button className="ghost sm" aria-label="Supprimer">✕</button></form>
              </div>
            </div>
          </div>
        );
      })}
      {!assets.length && <p className="mut">Aucune vidéo. Connecte Google Drive ci-dessus puis choisis un fichier.</p>}
    </div>
  );
}
