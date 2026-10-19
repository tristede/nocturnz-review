// Un projet : l'hôte y range et gère ses reviews ; l'invité venu par le lien du projet les voit toutes.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './AuthContext';
import * as data from './data';
import { AddAssetForm, AssetCard, AssetTile, DeleteButton, DropBar, HostingProvider, LinkLine, SharePanel, StorageGauge } from './library';
import Notice from './Notice';
import ProjectDeadline, { DeadlineBadge } from './ProjectDeadline';

export default function ProjectPage() {
  const { pid } = useParams();
  const nav = useNavigate();
  const { user, ready, signIn, signOut, switchAccount } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const [msg, setMsg] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [dragging, setDragging] = useState(false);

  const reload = useCallback(async () => {
    try {
      const project = await data.loadProject(pid);
      const admin = !!user && project.owner === user.uid;
      const [assets, projects] = await Promise.all([
        data.listProjectAssets(pid, admin ? user.uid : null),
        admin ? data.listProjects(user.uid) : [],
      ]);
      setState({ status: 'ok', project, assets, projects, admin });
    } catch (e) {
      setState({ status: e.code === 'not-found' ? 'missing' : 'denied' });
    }
  }, [pid, user]);
  useEffect(() => { if (ready) reload(); }, [ready, reload]);

  if (state.status === 'loading') return <Notice title="Chargement…" />;
  if (state.status === 'missing') return <Notice title="Projet introuvable" text="Ce lien ne correspond à aucun projet." />;
  if (state.status === 'denied') {
    return (
      <Notice title="Accès impossible" text="Ce projet est désactivé, expiré, ou réservé à des invités. Si on t’a invité, connecte-toi avec l’adresse Gmail invitée.">
        {user ? (
          <p className="mut">Connecté en tant que <strong style={{ color: 'var(--txt)' }}>{user.email}</strong>. <button className="link" onClick={() => switchAccount().catch(() => {})}>Changer de compte</button></p>
        ) : (
          <button onClick={() => signIn().catch(() => {})}>Se connecter avec Google</button>
        )}
      </Notice>
    );
  }

  const { project, assets, projects, admin } = state;
  const run = async (fn) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg(e.message || 'Échec'); } };

  if (!admin) {
    return (
      <div className="wrap">
        <div className="brand"><span>nocturnz</span><b>/ review</b></div>
        <div className="eyebrow">Projet</div>
        <h1>{project.name}</h1>
        <DeadlineBadge value={project.dueDate} label />
        <div className="tiles">
          {assets.map((a) => <AssetTile key={a.id} a={a} />)}
        </div>
        {!assets.length && <p className="mut empty-line">Projet vide</p>}
      </div>
    );
  }

  const rename = (e) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (name && name !== project.name) run(() => data.renameProject(pid, name));
    setRenaming(false);
  };
  const remove = () => data.deleteProject(pid, user.uid).then(() => nav('/')).catch((e) => setMsg(e.message));

  return (
    <HostingProvider uid={user.uid}>
    <div className="wrap">
      <Link className="eyebrow back" to="/">← Vos reviews</Link>
      <div className="project-head">
        {renaming ? (
          <form onSubmit={rename} className="row" style={{ flex: 1 }}>
            <input name="name" defaultValue={project.name} autoFocus onFocus={(e) => e.currentTarget.select()} maxLength={120} onBlur={(e) => e.currentTarget.form.requestSubmit()} />
          </form>
        ) : (
          <h1 title="Cliquer pour renommer" onClick={() => setRenaming(true)} style={{ cursor: 'text' }}>{project.name}</h1>
        )}
        <div className="row">
          <ProjectDeadline value={project.dueDate} onSave={async (date) => { await data.setProjectDeadline(pid, date); await reload(); }} />
          <SharePanel item={project} kind="projects" run={run} />
          <DeleteButton label="Supprimer le projet (ses reviews repassent dans « Sans projet »)" confirmText="Supprimer le projet ?" onConfirm={remove} />
        </div>
      </div>
      <LinkLine item={project} path={`/p/${pid}`} setMsg={setMsg} />
      {msg && <p className="mut">{msg}</p>}

      <div style={{ marginTop: 22 }}>
        <AddAssetForm uid={user.uid} project={pid} onDone={reload} />
        <StorageGauge />
      </div>
      {dragging && (
        <DropBar targets={[{ id: null, name: 'Sans projet' }, ...projects.filter((p) => p.id !== pid)]}
          onDropAsset={(aid, to) => { setDragging(false); if (aid) run(() => data.moveAsset(aid, to)); }} />
      )}
      {!!assets.length && <div className="section-title project-assets-title"><span>01</span><b>Assets</b></div>}
      {assets.map((a) => <AssetCard key={a.id} a={a} projects={projects} onChange={reload} onDragging={setDragging} />)}
      {!assets.length && <p className="mut empty-line">Aucun élément</p>}
    </div>
    </HostingProvider>
  );
}
