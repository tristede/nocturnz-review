// Éléments communs au tableau de bord et aux pages projet : cartes de review, partage, ajout d'un lien.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as data from './data';
import { checkYouTube, parseLink, thumbUrl } from './links';

const DAY = 86_400_000;
const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const day = (t) => new Date(t).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
const sourceLabel = (s) => (s === 'youtube' ? 'YouTube' : 'Drive');

export function shareLine(a) {
  if (a.revoked) return 'Lien désactivé';
  const parts = [a.access === 'invite' ? `sur invitation (${a.invited.length})` : 'lien secret'];
  parts.push(a.expiresAt ? (a.expiresAt < Date.now() ? 'expiré' : `expire le ${day(a.expiresAt)}`) : 'sans expiration');
  return parts.join(' · ');
}

// résout un lien collé ; renvoie { source, videoId, title? } ou lève un message lisible
export async function resolveLink(link) {
  const l = parseLink(link);
  if (!l) throw new Error('Lien non reconnu : colle un lien YouTube ou un lien Google Drive partagé « avec le lien ».');
  if (l.source === 'youtube') {
    const c = await checkYouTube(l.videoId);
    if (!c.ok) throw new Error('Cette vidéo YouTube est introuvable, privée, ou l’intégration est désactivée par son propriétaire.');
    return { ...l, title: c.title };
  }
  return l;
}

export const openCount = (a) => a.versions.reduce((n, v) => n + v.open, 0);
export const latestOf = (a) => a.versions[a.versions.length - 1];

export function Thumb({ v, className = 'thumb' }) {
  const [ok, setOk] = useState(true);
  return (
    <div className={className}>
      {v && ok && <img src={thumbUrl(v.source, v.videoId)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} />}
    </div>
  );
}

// partage d'une review (kind = 'assets') ou d'un projet entier (kind = 'projects')
export function SharePanel({ item, kind = 'assets', run }) {
  const save = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const exp = f.get('expires');
    const access = f.get('access');
    run(() => data.updateShare(item.id, {
      expiresAt: exp === 'keep' ? undefined : exp === 'never' ? null : Date.now() + Number(exp) * DAY,
      access,
      invited: access === 'invite' ? data.parseEmails(f.get('invited')) : item.invited,
    }, kind));
  };
  return (
    <details className="adv">
      <summary>Partage</summary>
      <div className="pop col">
        {kind === 'projects' && <span className="mut">Ce lien ouvre toutes les reviews du projet.</span>}
        <form onSubmit={save} className="col-form" key={`${item.access}-${item.invited.join()}`}>
          <label className="lbl">Accès</label>
          <label className="check"><input type="radio" name="access" value="link" defaultChecked={item.access === 'link'} /> Lien secret (sans compte)</label>
          <label className="check"><input type="radio" name="access" value="invite" defaultChecked={item.access === 'invite'} /> Sur invitation (connexion Google)</label>
          <label className="lbl">Gmail invités (si sur invitation)</label>
          <textarea name="invited" rows={3} defaultValue={item.invited.join('\n')} placeholder="prenom@gmail.com" style={{ width: '100%' }} />
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
        <button className="ghost sm" onClick={() => run(() => data.updateShare(item.id, { revoked: !item.revoked }, kind))}>{item.revoked ? 'Réactiver le lien' : 'Désactiver le lien'}</button>
      </div>
    </details>
  );
}

// ligne « lien secret · expire le … · https://… · copier »
export function LinkLine({ item, path, setMsg }) {
  const link = `${location.origin}${path}`;
  const copy = () => { try { navigator.clipboard.writeText(link); setMsg('Lien copié.'); } catch {} };
  return (
    <div className="mut linkline">
      {shareLine(item)} · <button className="link" style={{ padding: 0 }} onClick={copy} title={link}>Copier le lien</button>
    </div>
  );
}

// formulaire « titre + lien » ; project = id du projet où ranger la review (ou null)
export function AddAssetForm({ uid, project = null, projects = null, onDone }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (e) => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    setBusy(true); setErr('');
    try {
      const l = await resolveLink(f.get('link'));
      await data.createAsset({
        uid, title: String(f.get('title')).trim() || l.title || 'Sans titre', source: l.source, videoId: l.videoId,
        project: projects ? f.get('project') || null : project,
      });
      form.reset();
      await onDone();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <form onSubmit={add} style={{ display: 'grid', gap: 8 }}>
        <input name="title" placeholder="Titre (ex : Clip Zeph) — facultatif pour YouTube" />
        <div className="row">
          <input name="link" placeholder="Lien YouTube (même non répertorié) ou lien Google Drive partagé" required />
          {projects?.length > 0 && (
            <select name="project" defaultValue="" title="Ranger dans un projet">
              <option value="">Sans projet</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button disabled={busy}>{busy ? '…' : 'Ajouter'}</button>
        </div>
      </form>
      {err && <span className="mut">{err}</span>}
    </div>
  );
}

// carte d'une review côté hôte
export function AssetCard({ a, projects = [], onChange }) {
  const latest = latestOf(a);
  const open = openCount(a);
  const [msg, setMsg] = useState('');
  const run = async (fn) => { setMsg(''); try { await fn(); await onChange(); } catch (e) { setMsg(e.message || 'Échec'); } };

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

  return (
    <div className="card">
      <div className="asset-top">
        <Link to={`/r/${a.id}`} className="thumb-link"><Thumb v={latest} /></Link>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <Link to={`/r/${a.id}`} className="vtitle">{a.title}</Link>
          {open > 0 && <span className="badge">{open} à traiter</span>}
          {latest.status === 'approved' && <span className="badge ok">Validée</span>}
          {latest.status === 'changes' && <span className="badge">Modifications demandées</span>}
          <div className="vchips">
            {a.versions.map((v) => (
              <Link key={v.n} className="vchip" to={`/r/${a.id}?v=${v.n}`} title={`${v.count} commentaire(s)`}>v{v.n}{v.status === 'approved' ? ' ✓' : ''}</Link>
            ))}
            <span className="mut">{sourceLabel(latest.source)}</span>
          </div>
          <LinkLine item={a} path={`/r/${a.id}`} setMsg={setMsg} />
          {msg && <div className="mut" style={{ marginTop: 6 }}>{msg}</div>}
        </div>

        <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <SharePanel item={a} run={run} />

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
            <div className="pop col">
              <form onSubmit={saveFps} className="row">
                <select name="fps" defaultValue={latest.fps ?? ''} title={latest.source === 'youtube' ? 'YouTube ne donne pas le framerate : à régler à la main (25 par défaut)' : 'Images par seconde de la vidéo'}>
                  <option value="">{latest.source === 'youtube' ? 'Images/s : 25 (défaut)' : 'Images/s : auto'}</option>
                  {FPS_PRESETS.map((f) => <option key={f} value={f}>{f} images/s</option>)}
                </select>
                <button className="ghost sm">OK</button>
                <span className="mut" style={{ fontSize: 12 }}>v{latest.n}</span>
              </form>
              <label className="lbl">Projet</label>
              <select value={a.project || ''} style={{ width: '100%' }} onChange={(e) => run(() => data.moveAsset(a.id, e.target.value))}>
                <option value="">Sans projet</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="ghost sm" onClick={exportCsv} title={`Markers de la v${latest.n}`}>Export Premiere (v{latest.n})</button>
            </div>
          </details>

          <button className="ghost sm" aria-label="Supprimer" title="Supprimer" onClick={remove}>✕</button>
        </div>
      </div>
    </div>
  );
}

// tuile d'une review côté invité (page projet)
export function AssetTile({ a }) {
  const latest = latestOf(a);
  const open = openCount(a);
  return (
    <Link to={`/r/${a.id}`} className="tile">
      <Thumb v={latest} />
      <div className="tile-body">
        <span className="vtitle">{a.title}</span>
        <span className="mut">
          v{latest.n}
          {latest.status === 'approved' ? ' · validée' : latest.status === 'changes' ? ' · modifications demandées' : ''}
          {open > 0 ? ` · ${open} à traiter` : ''}
        </span>
      </div>
    </Link>
  );
}
