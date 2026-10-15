import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getAsset, getVersions } from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { accessState, verifyPassword, unlockCookie } from '@/lib/access';
import Review from './Review';

export const dynamic = 'force-dynamic';

async function unlock(fd) {
  'use server';
  const token = String(fd.get('token')), v = String(fd.get('v') || '');
  const asset = getAsset(token);
  if (!asset) notFound();
  await new Promise((r) => setTimeout(r, 500)); // ralentit les essais en rafale
  const q = v ? `v=${encodeURIComponent(v)}` : '';
  if (!verifyPassword(asset, fd.get('password'))) redirect(`/r/${token}?err=1${q ? `&${q}` : ''}`);
  const c = unlockCookie(asset);
  (await cookies()).set(c.name, c.value, c.options);
  redirect(`/r/${token}${q ? `?${q}` : ''}`);
}

function Notice({ title, text, children }) {
  return (
    <div className="wrap" style={{ maxWidth: 460, paddingTop: 120 }}>
      <div className="brand"><i /> Review</div>
      <h1 style={{ fontSize: 34 }}>{title}</h1>
      <p className="mut" style={{ marginBottom: 22 }}>{text}</p>
      {children}
    </div>
  );
}

export default async function Page({ params, searchParams }) {
  const { token } = await params;
  const { v, err, cmp } = await searchParams;
  const asset = getAsset(token);
  if (!asset) notFound();

  const st = await accessState(asset);
  if (st === 'revoked') return <Notice title="Lien désactivé" text="Ce lien de review n’est plus actif. Demande-en un nouveau à la personne qui te l’a envoyé." />;
  if (st === 'expired') return <Notice title="Lien expiré" text="Ce lien de review a expiré. Demande-en un nouveau à la personne qui te l’a envoyé." />;
  if (st === 'password') {
    return (
      <Notice title={asset.title} text="Cette review est protégée. Entre le mot de passe pour continuer.">
        <form action={unlock} className="row">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="v" value={v || ''} />
          <input name="password" type="password" placeholder="Mot de passe" autoFocus />
          <button>Entrer</button>
        </form>
        {err && <p className="mut" style={{ marginTop: 14 }}>Mot de passe incorrect.</p>}
      </Notice>
    );
  }

  const versions = getVersions(asset.id);
  const latest = versions[versions.length - 1];
  const current = versions.find((x) => String(x.version) === String(v)) || latest;
  return (
    <Review
      key={current.token}
      token={current.token}
      title={asset.title}
      admin={await isAdmin()}
      initialFps={current.fps}
      initialPeaks={current.peaks}
      source={current.source}
      videoId={current.drive_id}
      assetToken={asset.token}
      versions={versions.map((x) => ({ n: x.version, status: x.status, token: x.token, source: x.source, videoId: x.drive_id }))}
      initialCompare={versions.find((x) => String(x.version) === String(cmp) && x.version !== current.version)?.version ?? null}
      currentN={current.version}
      latestN={latest.version}
      initialStatus={current.status ? { status: current.status, by: current.status_by, at: current.status_at } : null}
    />
  );
}
