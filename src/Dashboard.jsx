import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import * as data from './data';
import { checkYouTube, parseLink } from './links';
import Notice from './Notice';

const DAY = 86_400_000;
const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const day = (t) => new Date(t).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
const sourceLabel = (s) => (s === 'youtube' ? 'YouTube' : 'Drive');

function shareLine(a) {
  if (a.revoked) return 'Lien désactivé';
  const parts = [a.access === 'invite' ? `sur invitation (${a.invited.length})` : 'lien secret'];
  parts.push(a.expiresAt ? (a.expiresAt < Date.now() ? 'expiré' : `expire le ${day(a.expiresAt)}`) : 'sans expiration');
  return parts.join(' · ');
}

// résout un lien collé ; renvoie { source, videoId, title? } ou lève un message lisible
async function resolveLink(link) {
  const l = parseLink(link);
  if (!l) throw new Error('Lien non reconnu : colle un lien YouTube ou un lien Google Drive partagé « avec le lien ».');
  if (l.source === 'youtube') {
    const c = await checkYouTube(l.videoId);
    if (!c.ok) throw new Error('Cette vidéo YouTube est introuvable, privée, ou l’intégration est désactivée par son propriétaire.');
    return { ...l, title: c.title };
  }
  return l;
}

function AssetCard({ a, onChange }) {
  const latest = a.versions[a.versions.length - 1];
  const open = a.versions.reduce((n, v) => n + v.open, 0);
  const [msg, setMsg] = useState('');
  const link = `${location.origin}/r/${a.id}`;
  const run = async (fn) => { setMsg(''); try { await fn(); await onChange(); } catch (e) { setMsg(e.message || 'Échec'); } };

  const saveShare = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const exp = f.get('expires');
    const access = f.get('access');
    run(() => data.updateShare(a.id, {
      expiresAt: exp === 'keep' ? undefined : exp === 'never' ? null : Date.now() + Number(exp) * DAY,
      access,
      invited: access === 'invite' ? data.parseEmails(f.get('invited')) : a.invited,
    }));
  };
  const addVersion = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    run(async () => {
      const l = await resolveLink(new FormData(form).get('link'));
      await data.addVersion(a.id, latest.n + 1, l.source, l.videoId);
      form.reset();
    });
  };
  const saveFps = (e) => {
    e.preventDefault();
    const v = Number(new FormData(e.currentTarget).get('fps'));
    run(() => data.saveVersion(a.id, latest.n, { fps: v > 0 ? v : null }));
  };
  const exportCsv = () => run(async () => {
    const tsv = await data.exportMarkers(a.id, latest);
    const url = URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' }));
    const el = Object.assign(document.createElement('a'), { href: url, download: `${a.title.replace(/[^\w-]+/g, '_')}-v${latest.n}-markers.csv` });
    el.click();
    URL.revokeObjectURL(url);
  });
  const remove = () => { if (confirm(`Supprimer « ${a.title} » et toutes ses versions ?`)) run(() => data.deleteAsset(a.id)); };
  const copy = () => { try { navigator.clipboard.writeText(link); setMsg('Lien copié.'); } catch {} };

  return (
    <div className="card">
      <div className="asset-top">
        <div style={{ flex: '1 1 300px' }}>
          <span className="vtitle">{a.title}</span>
          {open > 0 && <span className="badge">{open} à traiter</span>}
          {latest.status === 'approved' && <span className="badge ok">Validée</span>}
          {latest.status === 'changes' && <span className="badge">Modifications demandées</span>}
          <div className="vchips">
            {a.versions.map((v) => (
              <a key={v.n} className="vchip" href={`/r/${a.id}?v=${v.n}`} title={`${v.count} commentaire(s)`}>v{v.n}{v.status === 'approved' ? ' ✓' : ''}</a>
            ))}
            <span className="mut">{sourceLabel(latest.source)}</span>
          </div>
          <div className="mut" style={{ marginTop: 6 }}>
            {shareLine(a)} · <a href={link}>{link}</a> · <button className="link" style={{ padding: 0 }} onClick={copy}>copier</button>
          </div>
          {msg && <div className="mut" style={{ marginTop: 6 }}>{msg}</div>}
        </div>

        <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <details className="adv">
            <summary>Partage</summary>
            <div className="pop col">
              <form onSubmit={saveShare} className="col-form" key={`${a.access}-${a.invited.join()}`}>
                <label className="lbl">Accès</label>
                <label className="check"><input type="radio" name="access" value="link" defaultChecked={a.access === 'link'} /> Lien secret (sans compte)</label>
                <label className="check"><input type="radio" name="access" value="invite" defaultChecked={a.access === 'invite'} /> Sur invitation (connexion Google)</label>
                <label className="lbl">Gmail invités (si sur invitation)</label>
                <textarea name="invited" rows={3} defaultValue={a.invited.join('\n')} placeholder="prenom@gmail.com" style={{ width: '100%' }} />
                <label className="lbl">Expiration du lien</label>
                <select name="expires" defaultValue="keep" style={{ width: '100%' }}>
                  <option value="keep">Ne pas changer</option>
                  <option value="never">Jamais</option>
                  <option value="7">Dans 7 jours</option>
                  <option value="30">Dans 30 jours</option>
                  <option value="90">Dans 90 jours</option>
                </select>
                <button>Enregistrer</button>
              </form>
              <button className="ghost sm" onClick={() => run(() => data.updateShare(a.id, { revoked: !a.revoked }))}>{a.revoked ? 'Réactiver le lien' : 'Désactiver le lien'}</button>
            </div>
          </details>

          <details className="adv">
            <summary>Nouvelle version</summary>
            <div className="pop col">
              <span className="mut">Ajoute la v{latest.n + 1} : le lien de partage reste le même.</span>
              <form onSubmit={addVersion} className="row">
                <input name="link" placeholder="Lien YouTube ou Drive partagé" required />
                <button className="sm">Ajouter</button>
              </form>
            </div>
          </details>

          <details className="adv">
            <summary>Avancé</summary>
            <form onSubmit={saveFps} className="pop">
              <select name="fps" defaultValue={latest.fps ?? ''} title={latest.source === 'youtube' ? 'YouTube ne donne pas le framerate : à régler à la main (25 par défaut)' : 'Images par seconde de la vidéo'}>
                <option value="">{latest.source === 'youtube' ? 'Images/s : 25 (défaut)' : 'Images/s : auto'}</option>
                {FPS_PRESETS.map((f) => <option key={f} value={f}>{f} images/s</option>)}
              </select>
              <button className="ghost sm">OK</button>
              <span className="mut" style={{ fontSize: 12 }}>v{latest.n}</span>
            </form>
          </details>

          <button className="ghost sm" onClick={exportCsv} title={`Markers de la v${latest.n}`}>Export Premiere</button>
          <button className="ghost sm" aria-label="Supprimer" onClick={remove}>✕</button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, ready, signIn, signOut } = useAuth();
  const [assets, setAssets] = useState(null);
  const [denied, setDenied] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    try { setAssets(await data.listAssets(user.uid)); setDenied(false); } catch (e) { if (e.code === 'permission-denied') setDenied(true); else setErr(e.message); }
  }, [user]);
  useEffect(() => { setAssets(null); setDenied(false); reload(); }, [reload]);

  if (!ready) return <Notice title="Chargement…" />;
  if (!user) {
    return (
      <Notice title="Vos reviews" text="Espace réservé aux hôtes : connecte-toi avec ton compte Google.">
        <button onClick={() => signIn().catch((e) => setErr(e.message))}>Se connecter avec Google</button>
        {err && <p className="mut" style={{ marginTop: 14 }}>{err}</p>}
      </Notice>
    );
  }
  if (denied) {
    return (
      <Notice title="Accès réservé" text="Ce compte n’est pas autorisé à créer des reviews. Les invités n’ont pas besoin de passer par ici : ils utilisent le lien qu’on leur a envoyé.">
        <p className="mut">Connecté en tant que <strong style={{ color: 'var(--txt)' }}>{user.email}</strong>. <button className="link" onClick={signOut}>Changer de compte</button></p>
      </Notice>
    );
  }

  const add = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget), form = e.currentTarget;
    setBusy(true); setErr('');
    try {
      const l = await resolveLink(f.get('link'));
      await data.createAsset({ uid: user.uid, title: String(f.get('title')).trim() || l.title || 'Sans titre', source: l.source, videoId: l.videoId });
      form.reset();
      await reload();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 30 }}>
        <div className="brand" style={{ margin: 0 }}><i /> Review</div>
        <div className="row"><span className="mut">{user.email}</span><button className="ghost sm" onClick={signOut}>Se déconnecter</button></div>
      </div>
      <h1>Vos reviews</h1>

      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <form onSubmit={add} style={{ display: 'grid', gap: 8 }}>
          <input name="title" placeholder="Titre (ex : Clip Zeph) — facultatif pour YouTube" />
          <div className="row">
            <input name="link" placeholder="Lien YouTube (même non répertorié) ou lien Google Drive partagé" required />
            <button disabled={busy}>{busy ? '…' : 'Ajouter'}</button>
          </div>
        </form>
        {err && <span className="mut">{err}</span>}
      </div>

      {assets?.map((a) => <AssetCard key={a.id} a={a} onChange={reload} />)}
      {assets && !assets.length && <p className="mut">Aucune review. Colle un lien ci-dessus.</p>}
      {!assets && <p className="mut">Chargement…</p>}
    </div>
  );
}
