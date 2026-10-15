import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import * as data from './data';
import { AddAssetForm, AssetCard, Thumb, latestOf, openCount } from './library';
import Notice from './Notice';

function ProjectTile({ p, assets }) {
  const open = assets.reduce((n, a) => n + openCount(a), 0);
  const covers = assets.slice(0, 3);
  return (
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

  // une review dont le projet a disparu repasse dans « Sans projet »
  const ids = new Set(lib?.projects.map((p) => p.id));
  const loose = lib?.assets.filter((a) => !a.project || !ids.has(a.project)) ?? [];

  return (
    <div className="wrap">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 30 }}>
        <div className="brand" style={{ margin: 0 }}><i /> Review</div>
        <div className="row"><span className="mut">{user.email}</span><button className="ghost sm" onClick={signOut}>Se déconnecter</button></div>
      </div>
      <h1>Vos reviews</h1>

      <AddAssetForm uid={user.uid} projects={lib?.projects} onDone={reload} />
      {err && <p className="mut">{err}</p>}

      {!lib && <p className="mut">Chargement…</p>}
      {lib && (
        <>
          <div className="eyebrow section-title">Projets</div>
          <div className="tiles">
            {lib.projects.map((p) => <ProjectTile key={p.id} p={p} assets={lib.assets.filter((a) => a.project === p.id)} />)}
            <NewProject uid={user.uid} onDone={reload} />
          </div>

          <div className="eyebrow section-title">Sans projet</div>
          {loose.map((a) => <AssetCard key={a.id} a={a} projects={lib.projects} onChange={reload} />)}
          {!loose.length && <p className="mut">{lib.assets.length ? 'Toutes tes reviews sont rangées dans des projets.' : 'Aucune review. Colle un lien ci-dessus.'}</p>}
        </>
      )}
    </div>
  );
}
