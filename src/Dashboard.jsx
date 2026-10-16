import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import * as data from './data';
import { AddAssetForm, AssetCard, DropBar, DropZone, ExpiredCleanup, HostingProvider, StorageGauge, Thumb, latestOf, openCount } from './library';
import Notice from './Notice';

// menu « ⋯ » d'une tuile de projet : tout gérer sans ouvrir le projet
function ProjectMenu({ p, uid, onChange }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // null | 'rename' | 'confirm'
  const [msg, setMsg] = useState('');
  const close = () => { setOpen(false); setMode(null); setMsg(''); };
  const run = async (fn, keepOpen = false) => {
    try { await fn(); if (!keepOpen) close(); await onChange(); } catch (e) { setMsg(e.message || 'Échec'); }
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const copy = () => {
    try { navigator.clipboard.writeText(`${location.origin}/p/${p.id}`); setMsg('Lien copié.'); } catch {}
  };
  return (
    <div className="tile-menu" onClick={(e) => e.stopPropagation()}>
      <button className="ghost sm icon-sm" aria-label="Options du projet" title="Options du projet" onClick={() => (open ? close() : setOpen(true))}>⋯</button>
      {open && (
        <>
          <div className="menu-veil" onClick={close} />
          <div className="menu">
            {mode === 'rename' ? (
              <form className="col-form" onSubmit={(e) => {
                e.preventDefault();
                const name = String(new FormData(e.currentTarget).get('name')).trim();
                if (name && name !== p.name) run(() => data.renameProject(p.id, name)); else close();
              }}>
                <input name="name" defaultValue={p.name} autoFocus onFocus={(e) => e.currentTarget.select()} maxLength={120} />
                <div className="row"><button className="sm">Renommer</button><button type="button" className="ghost sm" onClick={() => setMode(null)}>Annuler</button></div>
              </form>
            ) : mode === 'confirm' ? (
              <div className="col-form">
                <span className="mut">Supprimer « {p.name} » ? Ses reviews restent, dans « Sans projet ».</span>
                <div className="row">
                  <button className="sm danger" onClick={() => run(() => data.deleteProject(p.id, uid))}>Supprimer</button>
                  <button className="ghost sm" onClick={() => setMode(null)}>Annuler</button>
                </div>
              </div>
            ) : (
              <>
                <button className="menu-item" onClick={() => setMode('rename')}>Renommer</button>
                <button className="menu-item" onClick={copy}>Copier le lien du projet</button>
                <button className="menu-item" onClick={() => run(() => data.updateShare(p.id, { revoked: !p.revoked }, 'projects'), true)}>
                  {p.revoked ? 'Réactiver le lien' : 'Désactiver le lien'}
                </button>
                <button className="menu-item danger" onClick={() => setMode('confirm')}>Supprimer le projet</button>
              </>
            )}
            {msg && <span className="mut" style={{ padding: '4px 8px' }}>{msg}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function ProjectTile({ p, assets, uid, onDropAsset, onChange }) {
  const open = assets.reduce((n, a) => n + openCount(a), 0);
  const covers = assets.slice(0, 3);
  return (
    <DropZone className="tile-drop" onDropAsset={onDropAsset}>
      <Link to={`/p/${p.id}`} className="tile">
        <div className={`cover n${covers.length}`}>
          {covers.map((a) => <Thumb key={a.id} v={latestOf(a)} />)}
        </div>
        <div className="tile-body">
          <span className="vtitle">{p.name}</span>
          <span className="mut">
            {assets.length ? `${assets.length} review${assets.length > 1 ? 's' : ''}` : 'Vide'}
            {open > 0 ? ` · ${open} à traiter` : ''}
            {p.revoked ? ' · lien désactivé' : ''}
          </span>
        </div>
      </Link>
      <ProjectMenu p={p} uid={uid} onChange={onChange} />
    </DropZone>
  );
}

function NewProject({ uid, onDone }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  if (!open) return <button className="tile new" onClick={() => setOpen(true)}>+ Nouveau projet</button>;
  const create = async (e) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (!name) return;
    try { await data.createProject(uid, name); setOpen(false); await onDone(); } catch (ex) { setErr(ex.message); }
  };
  return (
    <form className="tile new-form" onSubmit={create}>
      <input name="name" placeholder="Nom du projet" autoFocus maxLength={120} />
      <div className="row">
        <button className="sm">Créer</button>
        <button type="button" className="ghost sm" onClick={() => setOpen(false)}>Annuler</button>
      </div>
      {err && <span className="mut">{err}</span>}
    </form>
  );
}

export default function Dashboard() {
  const { user, ready, signIn, signOut } = useAuth();
  const [lib, setLib] = useState(null);
  const [denied, setDenied] = useState(false);
  const [err, setErr] = useState('');
  const [dragging, setDragging] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      const [assets, projects] = await Promise.all([data.listAssets(user.uid), data.listProjects(user.uid)]);
      setLib({ assets, projects });
      setDenied(false);
    } catch (e) { if (e.code === 'permission-denied') setDenied(true); else setErr(e.message); }
  }, [user]);
  useEffect(() => { setLib(null); setDenied(false); reload(); }, [reload]);

  if (!ready) return <Notice title="Chargement…" />;
  if (!user) {
    return (
      <Notice title="Review" text="Outil privé de review vidéo. Il n’est pas ouvert au public : l’accès se donne au cas par cas, sur demande. Si on t’a envoyé un lien de review, ouvre directement ce lien.">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <a className="btn-link" href="https://nocturnz.xyz/review/">Demander un accès</a>
          <button className="ghost" onClick={() => signIn().catch((e) => setErr(e.message))}>J’ai déjà un accès</button>
        </div>
        {err && <p className="mut" style={{ marginTop: 14 }}>{err}</p>}
      </Notice>
    );
  }
  if (denied) {
    return (
      <Notice title="Pas d’accès pour ce compte" text="Review n’est pas ouvert au public : les comptes qui créent des reviews sont ajoutés un par un, sur demande. Les clients n’ont pas besoin de passer par ici, ils utilisent le lien de review qu’on leur a envoyé.">
        <p className="mut">Connecté en tant que <strong style={{ color: 'var(--txt)' }}>{user.email}</strong>. <button className="link" onClick={signOut}>Changer de compte</button></p>
        <p style={{ marginTop: 14 }}><a className="btn-link" href="https://nocturnz.xyz/review/">Demander un accès</a></p>
      </Notice>
    );
  }

  // une review dont le projet a disparu repasse dans « Sans projet »
  const ids = new Set(lib?.projects.map((p) => p.id));
  const loose = lib?.assets.filter((a) => !a.project || !ids.has(a.project)) ?? [];
  const move = async (aid, pid) => {
    setDragging(false);
    if (!aid) return;
    try { await data.moveAsset(aid, pid); await reload(); } catch (e) { setErr(e.message); }
  };

  return (
    <HostingProvider uid={user.uid}>
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 30 }}>
        <div className="brand" style={{ margin: 0 }}><i /> Review</div>
        <div className="row"><span className="mut">{user.email}</span><button className="ghost sm" onClick={signOut}>Se déconnecter</button></div>
      </div>
      <h1>Vos reviews</h1>

      <AddAssetForm uid={user.uid} projects={lib?.projects} onDone={reload} />
      <StorageGauge />
      {lib && <ExpiredCleanup assets={lib.assets} onDone={reload} />}
      {err && <p className="mut">{err}</p>}

      {!lib && <p className="mut">Chargement…</p>}
      {lib && (
        <>
          <div className="eyebrow section-title">Projets</div>
          <div className="tiles">
            {lib.projects.map((p) => <ProjectTile key={p.id} p={p} assets={lib.assets.filter((a) => a.project === p.id)} uid={user.uid} onChange={reload} onDropAsset={(aid) => move(aid, p.id)} />)}
            <NewProject uid={user.uid} onDone={reload} />
          </div>

          <div className="eyebrow section-title">Sans projet</div>
          {dragging && lib.projects.length > 0 && <DropBar targets={lib.projects} onDropAsset={move} />}
          {loose.map((a) => <AssetCard key={a.id} a={a} projects={lib.projects} onChange={reload} onDragging={setDragging} />)}
          {loose.length > 0 && lib.projects.length > 0 && !dragging && <p className="mut hint">Astuce : glisse une review sur un projet pour l’y ranger.</p>}
          {!loose.length && <p className="mut">{lib.assets.length ? 'Toutes tes reviews sont rangées dans des projets.' : 'Aucune review. Importe un fichier ou colle un lien ci-dessus.'}</p>}
        </>
      )}
    </div>
    </HostingProvider>
  );
}
