// Éléments communs au tableau de bord et aux pages projet : cartes de review, partage, ajout d'un lien.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import * as data from './data';
import { ACCEPTED, APP_ICONS } from './appIcons';
import { KIND_LABEL, checkYouTube, driveMeta, kindOf, parseLink, thumbUrl } from './links';
import { fmtGB, removeObject, usage } from './storage';
import { importFile, keysOf } from './importer';

const DAY = 86_400_000;
const FPS_PRESETS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const day = (t) => new Date(t).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: 'numeric' });
const sourceLabel = (v) => (v.source === 'youtube' ? 'YouTube' : v.source === 'file' ? `${KIND_LABEL[v.kind] || 'Fichier'} · fichier importé` : v.kind && v.kind !== 'video' ? KIND_LABEL[v.kind] : 'Drive');

/* ───────── Hébergement de l'hôte : réglage + place occupée, partagés par toute la page ───────── */
const HostingCtx = createContext({ hosting: null, used: null, ready: false, error: '', refresh: () => {} });
export function HostingProvider({ uid, children }) {
  const [st, setSt] = useState({ hosting: null, used: null, ready: false, error: '' });
  const refresh = useCallback(async () => {
    try {
      const hosting = await data.loadHosting(uid);
      if (!hosting) return setSt({ hosting: null, used: null, ready: true, error: '' });
      try { const u = await usage(hosting); setSt({ hosting, used: u.bytes, ready: true, error: '' }); }
      catch (e) { setSt({ hosting, used: null, ready: true, error: e.message }); }
    } catch { setSt((s) => ({ ...s, ready: true })); }
  }, [uid]);
  useEffect(() => { if (uid) refresh(); }, [uid, refresh]);
  return <HostingCtx.Provider value={{ ...st, refresh }}>{children}</HostingCtx.Provider>;
}
export const useHosting = () => useContext(HostingCtx);

// jauge « 3,2 / 9,5 Go » ; rouge au-delà de 90 %
export function StorageGauge() {
  const { hosting, used, ready, error } = useHosting();
  if (!ready) return null;
  if (!hosting) {
    return <p className="mut gauge-line">Stockage non connecté <Link to="/hebergement">Configurer</Link></p>;
  }
  if (error) return <p className="mut gauge-line warn">Hébergement injoignable : {error} <Link to="/hebergement">Réglages</Link></p>;
  const ratio = Math.min(1, (used || 0) / hosting.limitBytes);
  return (
    <div className={`gauge ${ratio > 0.9 ? 'full' : ''}`} title="Place utilisée dans ton hébergement">
      <div className="gauge-bar"><i style={{ width: `${ratio * 100}%` }} /></div>
      <span className="mut">{fmtGB(used || 0)} / {fmtGB(hosting.limitBytes)}</span>
      <Link className="mut" to="/hebergement">Réglages</Link>
    </div>
  );
}

// reviews expirées qui occupent encore de la place : les supprimer d'un geste (pas de serveur pour le faire seul)
export function ExpiredCleanup({ assets, onDone }) {
  const { hosting, refresh } = useHosting();
  const [busy, setBusy] = useState(false);
  const old = assets.filter((a) => a.expiresAt && a.expiresAt < Date.now() && a.versions.some((v) => v.source === 'file'));
  if (!hosting || !old.length) return null;
  const bytes = old.reduce((n, a) => n + a.versions.reduce((m, v) => m + (v.source === 'file' ? v.size || 0 : 0), 0), 0);
  const purge = async () => {
    setBusy(true);
    try {
      for (const a of old) {
        for (const k of a.versions.flatMap(keysOf)) await removeObject(hosting, k);
        await data.deleteAsset(a.id);
      }
    } finally { setBusy(false); refresh(); onDone(); }
  };
  return (
    <div className="gauge-line expired">
      <span className="mut">{old.length} review{old.length > 1 ? 's' : ''} expirée{old.length > 1 ? 's' : ''} occupe{old.length > 1 ? 'nt' : ''} encore {fmtGB(bytes)}.</span>
      {busy ? <span className="mut">Suppression…</span> : <DeleteButton label="Supprimer les reviews expirées et leurs fichiers" confirmText={`Supprimer ${old.length > 1 ? 'les' : 'la'} review${old.length > 1 ? 's' : ''} ?`} onConfirm={purge} />}
    </div>
  );
}

// suit un import : étape, avancement, annulation
function useImportJob() {
  const [job, setJob] = useState(null); // { step, p }
  const ctrl = useRef(null);
  const run = async (fn) => {
    ctrl.current = new AbortController();
    setJob({ step: 'Préparation…', p: 0 });
    try {
      return await fn({
        signal: ctrl.current.signal,
        onStep: (step) => setJob((j) => ({ ...j, step })),
        onProgress: (p) => setJob((j) => ({ ...j, p })),
      });
    } finally { setJob(null); }
  };
  return { job, run, cancel: () => ctrl.current?.abort() };
}
function ImportProgress({ job, onCancel }) {
  if (!job) return null;
  return (
    <div className="import-progress">
      <div className="gauge-bar"><i style={{ width: `${Math.round(job.p * 100)}%` }} /></div>
      <span className="mut">{job.step} {job.p > 0 && job.p < 1 ? `${Math.round(job.p * 100)} %` : ''}</span>
      <button type="button" className="link" onClick={onCancel}>Annuler</button>
    </div>
  );
}
const baseName = (name) => name.replace(/\.\w{1,6}$/, '');

export function shareLine(a) {
  if (a.revoked) return 'Lien désactivé';
  const parts = [a.access === 'invite' ? `sur invitation (${a.invited.length})` : 'lien secret'];
  parts.push(a.expiresAt ? (a.expiresAt < Date.now() ? 'expiré' : `expire le ${day(a.expiresAt)}`) : 'sans expiration');
  return parts.join(' · ');
}

// résout un lien collé ; renvoie { source, videoId, kind, name, title? } ou lève un message lisible
export async function resolveLink(link) {
  const l = parseLink(link);
  if (!l) throw new Error('Lien non reconnu : colle un lien YouTube ou un lien Google Drive partagé « avec le lien ».');
  if (l.source === 'youtube') {
    const c = await checkYouTube(l.videoId);
    if (!c.ok) throw new Error('Cette vidéo YouTube est introuvable, privée, ou l’intégration est désactivée par son propriétaire.');
    return { ...l, kind: 'video', name: null, title: c.title };
  }
  // Drive : le type du fichier décide du lecteur (vidéo, ou page par page)
  const m = await driveMeta(l.videoId);
  if (!m) throw new Error('Google Drive ne répond pas : réessaie dans un instant.');
  if (m.denied) throw new Error('Fichier Drive inaccessible : vérifie qu’il est partagé « Tous les utilisateurs disposant du lien ».');
  const kind = kindOf(m.mimeType, m.name);
  if (kind === 'video') throw new Error('Les vidéos depuis Google Drive ne sont plus prises en charge (Google bloque les fichiers lourds). Pour une vidéo, utilise un lien YouTube non répertorié.');
  if (!kind) throw new Error(`Type de fichier non pris en charge (${m.name}). Depuis Drive : image, SVG, PDF, Word (.docx), Photoshop (.psd), Google Docs/Slides. Vidéo : lien YouTube.`);
  return { ...l, kind, name: m.name, title: m.name.replace(/\.\w{2,5}$/, '') };
}

export const openCount = (a) => a.versions.reduce((n, v) => n + v.open, 0);
export const latestOf = (a) => a.versions[a.versions.length - 1];

export function Thumb({ v, className = 'thumb' }) {
  const [ok, setOk] = useState(true);
  const src = !v ? null : v.source === 'file' ? v.thumb : thumbUrl(v.source, v.videoId);
  return (
    <div className={className}>
      {src && ok && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setOk(false)} />}
    </div>
  );
}

// partage d'une review (kind = 'assets') ou d'un projet entier (kind = 'projects')
export function SharePanel({ item, kind = 'assets', run }) {
  const dialog = useRef(null);
  const [message, setMessage] = useState('');
  const project = kind === 'projects';
  const link = `${location.origin}/${project ? 'p' : 'r'}/${item.id}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setMessage('Lien copié.'); }
    catch { setMessage('Copie impossible. Sélectionne le lien ci-dessus.'); }
  };
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
    <>
      <button className="ghost sm" onClick={() => { setMessage(''); dialog.current.showModal(); }}>
        {project ? 'Partager le projet' : 'Partager ce fichier'}
      </button>
      {createPortal(<dialog ref={dialog} aria-label={project ? 'Partager le projet' : 'Partager ce fichier'} className="share-dialog" onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
      <div className="share-content">
        <div className="share-heading"><h2>{project ? 'Partager le projet' : 'Partager ce fichier'}</h2><button className="ghost sm" aria-label="Fermer le partage" onClick={() => dialog.current.close()}>×</button></div>
        <p className="mut share-name">{item.name || item.title}</p>
        {project && <p className="mut">Toutes les reviews du projet.</p>}
        <div className="share-link"><input aria-label={project ? 'Lien du projet' : 'Lien du fichier'} value={link} readOnly onFocus={(e) => e.currentTarget.select()} /><button onClick={copy}>Copier</button></div>
        {message && <span className="mut" role="status">{message}</span>}
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
      </dialog>, document.body)}
    </>
  );
}

// ligne « lien secret · expire le … · https://… · copier »
export function LinkLine({ item, path, setMsg }) {
  const link = `${location.origin}${path}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setMsg('Lien copié.'); } catch { setMsg('Copie impossible. Ouvre le partage pour sélectionner le lien.'); } };
  return (
    <div className="mut linkline">
      {item.revoked && <span>Lien désactivé · </span>}<button className="link" style={{ padding: 0 }} onClick={copy} title={link}>Copier le lien</button>
    </div>
  );
}

// formulaire « titre + lien » ; project = id du projet où ranger la review (ou null)
// rangée d'icônes des formats acceptés ; celles du lien collé s'allument
function Accepted({ link }) {
  const [det, setDet] = useState(null); // { source, kind, svg, name } | { checking } | { error }
  useEffect(() => {
    const l = parseLink(link);
    if (!l) { setDet(link.trim() ? { error: 'Lien non reconnu' } : null); return; }
    if (l.source === 'youtube') { setDet({ source: 'youtube', kind: 'video' }); return; }
    setDet({ source: 'drive', checking: true });
    let dead = false;
    const t = setTimeout(async () => {
      const m = await driveMeta(l.videoId);
      if (dead) return;
      if (!m) return setDet({ source: 'drive', error: 'Drive ne répond pas' });
      if (m.denied) return setDet({ source: 'drive', error: 'Fichier non partagé « avec le lien »' });
      const kind = kindOf(m.mimeType, m.name);
      if (kind === 'video') return setDet({ source: 'drive', error: 'Vidéo Drive : utilise plutôt un lien YouTube non répertorié' });
      setDet(kind
        ? { source: 'drive', kind, name: m.name, svg: m.mimeType === 'image/svg+xml' || /\.svg$/i.test(m.name) }
        : { source: 'drive', error: `${m.name} : format non pris en charge` });
    }, 400);
    return () => { dead = true; clearTimeout(t); };
  }, [link]);

  const lit = det && !det.error && !det.checking;
  const caption = !det ? ''
    : det.error ? det.error
    : det.checking ? 'Vérification du fichier…'
    : det.source === 'youtube' ? 'Vidéo YouTube'
    : `${det.name} · ${ACCEPTED.find((a) => a.key !== 'drive' && a.match(det))?.label || ''}`;
  return (
    <div className={`accepted ${det ? 'has' : ''}`}>
      <div className="app-icons">
        {ACCEPTED.map((a) => (
          <span key={a.key} className="app-tip" data-label={a.label} aria-label={a.label} role="img">
            <span className={`app-ic ${lit ? (a.match(det) ? 'on' : 'off') : ''}`}>{APP_ICONS[a.key].glyph}</span>
          </span>
        ))}
      </div>
      {caption && <span className={`mut ${det?.error ? 'warn' : ''}`}>{caption}</span>}
    </div>
  );
}

export function AddAssetForm({ uid, project = null, projects = null, onDone }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [proj, setProj] = useState('');
  const [over, setOver] = useState(false);
  const { hosting, refresh } = useHosting();
  const { job, run: runJob, cancel } = useImportJob();
  const fileInput = useRef(null);

  // import d'un fichier depuis l'ordinateur vers l'hébergement de l'hôte
  const importOne = async (file) => {
    if (!file || job) return;
    setErr('');
    try {
      await runJob(async (opts) => {
        const aid = data.newToken();
        const v = await importFile({ hosting, file, aid, n: 1, ...opts });
        await data.createAsset({ uid, aid, title: title.trim() || baseName(file.name), project: projects ? proj || null : project, ...v });
      });
      setTitle('');
      refresh();
      await onDone();
    } catch (ex) { if (!ex.aborted) setErr(ex.message); }
  };
  const isFiles = (e) => e.dataTransfer?.types?.includes('Files');
  const add = async (e) => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    setBusy(true); setErr('');
    try {
      const l = await resolveLink(f.get('link'));
      await data.createAsset({
        uid, title: title.trim() || l.title || 'Sans titre', source: l.source, videoId: l.videoId, kind: l.kind, name: l.name,
        project: projects ? proj || null : project,
      });
      form.reset();
      setLink(''); setTitle('');
      await onDone();
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className={`card add-card ${over ? 'file-over' : ''}`} style={{ display: 'grid', gap: 10 }}
      onDragEnter={(e) => { if (isFiles(e)) { e.preventDefault(); setOver(true); } }}
      onDragOver={(e) => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(e) => { if (isFiles(e) && !e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { if (!isFiles(e)) return; e.preventDefault(); setOver(false); importOne(e.dataTransfer.files[0]); }}>
      <form onSubmit={add} style={{ display: 'grid', gap: 8 }}>
        <div className="row">
          <input name="link" placeholder="Lien YouTube ou document Drive" value={link} onChange={(e) => setLink(e.target.value)} required={!!link} />
          {projects?.length > 0 && (
            <select name="project" value={proj} onChange={(e) => setProj(e.target.value)} title="Ranger dans un projet">
              <option value="">Sans projet</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {link.trim()
            ? <button disabled={busy || !!job}>{busy ? '…' : 'Ajouter'}</button>
            : <button type="button" disabled={!!job} onClick={() => (hosting ? fileInput.current.click() : setErr('Branche d’abord ton hébergement (lien sous ce formulaire) pour importer des fichiers.'))}>Importer</button>}
          <input ref={fileInput} type="file" hidden accept="video/*,image/*,.svg,.pdf,.docx,.psd,.psb"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; importOne(f); }} />
        </div>
        <details className="optional-title">
          <summary>Nom personnalisé</summary>
          <input name="title" placeholder="Nom de la review" value={title} onChange={(e) => setTitle(e.target.value)} />
        </details>
        {job ? <ImportProgress job={job} onCancel={cancel} /> : <Accepted link={link} />}
      </form>
      {over && <div className="drop-hint">Dépose le fichier pour l’importer</div>}
      {err && <span className="mut">{err}</span>}
    </div>
  );
}

// ✕ puis « Supprimer ? » : deux clics, sans fenêtre système ; se referme tout seul après 4 s
export function DeleteButton({ label = 'Supprimer', confirmText = 'Supprimer ?', onConfirm }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return armed
    ? <button className="sm danger" onClick={() => { setArmed(false); onConfirm(); }} onBlur={() => setArmed(false)} autoFocus>{confirmText}</button>
    : <button className="ghost sm" aria-label={label} title={label} onClick={() => setArmed(true)}>✕</button>;
}

/* ───────── Glisser-déposer : ranger une review dans un projet, ou l'en sortir ───────── */
const DND = 'application/x-nocturnz-review';

// zone où l'on peut déposer une review ; onDropAsset(id de la review)
export function DropZone({ onDropAsset, className = '', children, ...rest }) {
  const [over, setOver] = useState(0);
  const accepts = (e) => e.dataTransfer.types.includes(DND);
  return (
    <div {...rest} className={`${className} ${over ? 'drop-over' : ''}`}
      onDragEnter={(e) => { if (accepts(e)) { e.preventDefault(); setOver((n) => n + 1); } }}
      onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDragLeave={(e) => { if (accepts(e)) setOver((n) => Math.max(0, n - 1)); }}
      onDrop={(e) => { if (!accepts(e)) return; e.preventDefault(); setOver(0); onDropAsset(e.dataTransfer.getData(DND)); }}>
      {children}
    </div>
  );
}

// barre de destinations qui apparaît pendant qu'on glisse une review
export function DropBar({ targets, onDropAsset }) {
  return (
    <div className="dropbar">
      <span className="mut">Déposer dans</span>
      {targets.map((t) => (
        <DropZone key={t.id ?? 'none'} className="drop-chip" onDropAsset={(aid) => onDropAsset(aid, t.id)}>{t.name}</DropZone>
      ))}
    </div>
  );
}

// carte d'une review côté hôte ; onDragging(true|false) prévient la page qu'un glisser commence ou finit
export function AssetCard({ a, projects = [], onChange, onDragging }) {
  const [canDrag, setCanDrag] = useState(false);
  const [dragged, setDragged] = useState(false);
  const latest = latestOf(a);
  const open = openCount(a);
  const isVideo = !latest.kind || latest.kind === 'video';
  const [msg, setMsg] = useState('');
  const { hosting, refresh } = useHosting();
  const { job, run: runJob, cancel } = useImportJob();
  const run = async (fn) => { setMsg(''); try { await fn(); await onChange(); } catch (e) { if (!e.aborted) setMsg(e.message || 'Échec'); } };
  // supprimer la review efface aussi ses fichiers importés (et libère la place)
  const remove = () => run(async () => {
    const keys = a.versions.flatMap(keysOf);
    if (keys.length && hosting) for (const k of keys) await removeObject(hosting, k);
    await data.deleteAsset(a.id);
    if (keys.length) refresh();
  });
  const importVersion = (file) => file && run(() => runJob(async (opts) => {
    const v = await importFile({ hosting, file, aid: a.id, n: latest.n + 1, ...opts });
    await data.addVersion(a.id, latest.n + 1, v);
    refresh();
  }));

  const addVersion = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    run(async () => {
      const l = await resolveLink(new FormData(form).get('link'));
      await data.addVersion(a.id, latest.n + 1, l);
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

  return (
    <div className={`card ${onDragging ? 'grab' : ''} ${dragged ? 'dragging' : ''}`}
      draggable={!!onDragging && canDrag}
      // on ne glisse pas depuis un champ, un menu ou un bouton (sinon impossible de sélectionner du texte)
      onPointerDown={(e) => setCanDrag(!e.target.closest('input, textarea, select, button, details'))}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND, a.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragged(true); onDragging?.(true);
      }}
      onDragEnd={() => { setDragged(false); onDragging?.(false); }}>
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
            <span className="mut">{sourceLabel(latest)}</span>
          </div>
          <LinkLine item={a} path={`/r/${a.id}`} setMsg={setMsg} />
          {job && <ImportProgress job={job} onCancel={cancel} />}
          {msg && <div className="mut" style={{ marginTop: 6 }}>{msg}</div>}
        </div>

        <div className="row asset-actions" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <SharePanel item={a} run={run} />

          <details className="adv">
            <summary>Nouvelle version</summary>
            <div className="pop col">
              <span className="mut">Version {latest.n + 1}</span>
              {hosting && (
                <label className="file-pick">
                  <span className="sm-btn">Importer un fichier</span>
                  <input type="file" hidden accept="video/*,image/*,.svg,.pdf,.docx,.psd,.psb" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; importVersion(f); }} />
                </label>
              )}
              <form onSubmit={addVersion} className="row">
                <input name="link" placeholder={hosting ? 'ou un lien YouTube / Drive' : 'Lien YouTube ou Drive partagé'} required />
                <button className="sm">Ajouter</button>
              </form>
            </div>
          </details>

          <details className="adv">
            <summary>Avancé</summary>
            <div className="pop col">
              {isVideo && <form onSubmit={saveFps} className="row">
                <select name="fps" defaultValue={latest.fps ?? ''} title={latest.source === 'youtube' ? 'YouTube ne donne pas le framerate : à régler à la main (25 par défaut)' : 'Images par seconde de la vidéo'}>
                  <option value="">{latest.source === 'youtube' ? 'Images/s : 25 (défaut)' : 'Images/s : auto'}</option>
                  {FPS_PRESETS.map((f) => <option key={f} value={f}>{f} images/s</option>)}
                </select>
                <button className="ghost sm">OK</button>
                <span className="mut" style={{ fontSize: 12 }}>v{latest.n}</span>
              </form>}
              <label className="lbl">Projet</label>
              <select value={a.project || ''} style={{ width: '100%' }} onChange={(e) => run(() => data.moveAsset(a.id, e.target.value))}>
                <option value="">Sans projet</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {isVideo && <button className="ghost sm" onClick={exportCsv} title={`Markers de la v${latest.n}`}>Export Premiere (v{latest.n})</button>}
            </div>
          </details>

          <DeleteButton label="Supprimer la review et ses versions" confirmText="Supprimer la review ?" onConfirm={remove} />
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
    <Link to={`/r/${a.id}`} state={{ fromProject: a.project }} className="tile">
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
