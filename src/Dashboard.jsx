import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { usingEmulators } from './firebase';
import * as data from './data';
import { AddAssetForm, AssetCard, DeleteButton, DropBar, DropZone, ExpiredCleanup, HostingProvider, StorageGauge, Thumb, latestOf, openCount } from './library';
import Notice from './Notice';
import ProjectDeadline from './ProjectDeadline';
import { disablePush, enablePush, isIOS, isStandalone, pushState } from './push';

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
      <div className="tile-deadline"><ProjectDeadline value={p.dueDate} onSave={async (date) => { await data.setProjectDeadline(p.id, date); await onChange(); }} /></div>
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
    const dueDate = String(new FormData(e.currentTarget).get('dueDate') || '') || null;
    try { await data.createProject(uid, name, dueDate); setOpen(false); await onDone(); } catch (ex) { setErr(ex.message); }
  };
  return (
    <form className="tile new-form" onSubmit={create}>
      <input name="name" placeholder="Nom du projet" autoFocus maxLength={120} />
      <label className="project-create-deadline">Échéance<input type="date" name="dueDate" aria-label="Échéance du projet (facultative)" max="9999-12-31" /></label>
      <div className="row">
        <button className="sm">Créer</button>
        <button type="button" className="ghost sm" onClick={() => setOpen(false)}>Annuler</button>
      </div>
      {err && <span className="mut">{err}</span>}
    </form>
  );
}

// notifications push sur cet appareil (sur iPhone : seulement depuis la web app ajoutée à l'écran d'accueil)
const Bell = ({ off }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10 20a2.2 2.2 0 0 0 4 0" />
    {off && <path d="M3.5 3.5l17 17" />}
  </svg>
);
function NotifyButton() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tip, setTip] = useState('');
  useEffect(() => { pushState().then(setSt).catch(() => setSt('unsupported')); }, []);
  useEffect(() => { if (!tip) return; const t = setTimeout(() => setTip(''), 4500); return () => clearTimeout(t); }, [tip]);
  if (!st || st === 'unsupported') return null;
  const label = { on: 'Notifications activées sur cet appareil (toucher pour désactiver)', off: 'Activer les notifications sur cet appareil', install: 'Ajoute Review à l’écran d’accueil (Partager → « Sur l’écran d’accueil ») pour recevoir les notifications', denied: 'Notifications bloquées dans les réglages de l’appareil' }[st];
  const click = async () => {
    if (st === 'install' || st === 'denied') return setTip(label);
    setBusy(true); setTip('');
    try {
      if (st === 'on') await disablePush(); else await enablePush();
      const next = await pushState();
      setSt(next);
      setTip(next === 'on' ? 'Notifications activées' : 'Notifications désactivées');
    } catch (e) { setTip(e.message); } finally { setBusy(false); }
  };
  return (
    <span className="notify">
      <button className={`ghost icon-btn ${st === 'on' ? 'on' : ''}`} disabled={busy} onClick={click} aria-label={label} title={label} aria-pressed={st === 'on'}>
        <Bell off={st === 'denied' || st === 'install'} />
        {st === 'on' && <i className="notify-dot" />}
      </button>
      {tip && <span className="notify-tip" role="status">{tip}</span>}
    </span>
  );
}

// Tutoriel iPhone : 1) ajouter Review à l'écran d'accueil depuis Safari, 2) activer les notifications dans la web app.
const GUIDE_KEY = 'review-ios-guide-later';
const ShareIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5v10h14V11h-1" /></svg>;
const AddIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></svg>;
function IOSGuide() {
  const [step, setStep] = useState(null); // 'install' | 'notify' | null
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!isIOS()) return;
    try { if (Number(localStorage.getItem(GUIDE_KEY)) > Date.now()) return; } catch {}
    if (!isStandalone()) { setStep('install'); return; }
    pushState().then((st) => { if (st === 'off') setStep('notify'); }).catch(() => {});
  }, []);
  if (!step) return null;
  const later = () => { try { localStorage.setItem(GUIDE_KEY, String(Date.now() + 7 * 86_400_000)); } catch {} setStep(null); };
  const activate = async () => {
    setBusy(true); setErr('');
    try { await enablePush(); setStep(null); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="ios-guide" role="dialog" aria-label="Installer Review sur l’iPhone">
      <img src="/icon-192.png" alt="" className="ios-guide-logo" />
      {step === 'install' ? (
        <>
          <h2>Review sur ton iPhone</h2>
          <p className="mut">Ajoute-la à l’écran d’accueil : elle s’ouvre comme une app et peut t’envoyer une notification à chaque retour client.</p>
          <ol>
            <li><span className="ios-step">1</span><span>Touche <b className="ios-key"><ShareIcon /> Partager</b> dans la barre de Safari.</span></li>
            <li><span className="ios-step">2</span><span>Choisis <b className="ios-key"><AddIcon /> Sur l’écran d’accueil</b>, puis « Ajouter ».</span></li>
            <li><span className="ios-step">3</span><span>Ouvre Review depuis la nouvelle icône et active les notifications.</span></li>
          </ol>
          <button className="ghost" onClick={later}>Plus tard</button>
        </>
      ) : (
        <>
          <h2>Dernière étape</h2>
          <p className="mut">Active les notifications pour être prévenu dès qu’un client commente ou valide une version.</p>
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={activate} disabled={busy}>{busy ? '…' : 'Activer les notifications'}</button>
            <button className="ghost" onClick={later}>Plus tard</button>
          </div>
          {err && <p className="mut warn">{err}</p>}
        </>
      )}
    </div>
  );
}

// Club privé : inviter quelqu'un (2 places par membre, illimité pour un admin), voir ses invités, annuler
const PeopleIcon = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.8c1.7.8 2.7 2.5 3 5.2" /></svg>;
function ClubButton({ user }) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState(null); // { admin, cards, used }
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState({ text: '', ok: false });
  const [sent, setSent] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const admin = await data.isClubAdmin();
    const club = await data.loadClub(user.uid, admin);
    setSt({ admin, ...club });
  }, [user.uid]);
  useEffect(() => { if (open && !st) load().catch((e) => setMsg({ text: e.message })); }, [open, st, load]);
  const me = { uid: user.uid, name: user.displayName, admin: st?.admin, used: st?.used ?? 0 };
  const left = st ? (st.admin ? Infinity : Math.max(0, data.CLUB_MAX - st.used)) : 0;
  const invite = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: '' }); setSent('');
    try {
      const isNew = await data.clubInvite(me, email);
      if (!isNew) setMsg({ text: `${email.trim().toLowerCase()} est déjà membre ou invité.` });
      else { setSent(email.trim().toLowerCase()); setEmail(''); await load(); }
    } catch (ex) { setMsg({ text: ex.message }); } finally { setBusy(false); }
  };
  const inviteText = (to) => `Je t’invite sur Nocturnz Review (club privé, review vidéo à l’image près) : ouvre ${location.origin} et connecte-toi avec Google (${to}).`;
  const copy = async (to) => {
    try { await navigator.clipboard.writeText(inviteText(to)); setMsg({ text: 'Message copié.', ok: true }); } catch { setMsg({ text: inviteText(to), ok: true }); }
  };
  const share = (to) => navigator.share?.({ title: 'Invitation Nocturnz Review', text: inviteText(to) }).catch(() => {});
  const cancel = async (c) => {
    try { await data.cancelClubInvite(me, c.email); await load(); } catch (ex) { setMsg({ text: ex.message }); }
  };
  const others = (st?.cards || []).filter((c) => c.email !== String(user.email).toLowerCase());
  return (
    <span className="club">
      <button className={`ghost icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Club privé : inviter quelqu’un" title="Club privé : inviter quelqu’un"><PeopleIcon /></button>
      {open && (
        <>
          <div className="menu-veil" onClick={() => setOpen(false)} />
          <div className="club-panel" role="dialog" aria-label="Club privé">
            <div className="club-head">
              <strong>Club privé</strong>
              <span className="mut">{!st ? '…' : st.admin ? 'admin · invitations illimitées' : `${left} invitation${left > 1 ? 's' : ''} sur ${data.CLUB_MAX}`}</span>
            </div>
            <p className="mut club-intro">Les membres créent leurs propres reviews. Tes clients, eux, n’ont pas besoin d’être membres : ils utilisent le lien de review.</p>
            {st && left > 0 && (
              <form className="row" onSubmit={invite}>
                <input type="email" inputMode="email" autoComplete="off" placeholder="adresse Gmail à inviter" value={email} onChange={(e) => setEmail(e.target.value)} required />
                <button className="sm" disabled={busy}>{busy ? '…' : 'Inviter'}</button>
              </form>
            )}
            {sent && (
              <div className="club-sent">
                <span><b>{sent}</b> peut entrer. Envoie-lui le lien :</span>
                <div className="row">
                  <button className="ghost sm" onClick={() => copy(sent)}>Copier le message</button>
                  {navigator.share && <button className="ghost sm" onClick={() => share(sent)}>Envoyer…</button>}
                </div>
              </div>
            )}
            {msg.text && <p className={`mut ${msg.ok ? 'okmsg' : 'warn'}`}>{msg.text}</p>}
            {others.length > 0 && (
              <ul className="club-list">
                {others.map((c) => (
                  <li key={c.email}>
                    <span className="club-mail">{c.email}{st.admin && c.byName ? <small> · par {c.byName}</small> : null}</span>
                    <span className={`club-state ${c.joined ? 'ok' : ''}`}>{c.joined ? 'membre' : 'en attente'}</span>
                    {(st.admin || !c.joined) && <DeleteButton label={c.joined ? 'Retirer du club' : 'Annuler l’invitation'} confirmText={c.joined ? 'Retirer ?' : 'Annuler ?'} onConfirm={() => cancel(c)} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </span>
  );
}

export default function Dashboard() {
  const { user, ready, signIn, signOut, switchAccount } = useAuth();
  const [lib, setLib] = useState(null);
  const [denied, setDenied] = useState(false);
  const [err, setErr] = useState('');
  const [dragging, setDragging] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    try {
      await data.activateCard(user); // invité du club : sa carte devient « membre » à la première connexion
      const [assets, projects] = await Promise.all([data.listAssets(user.uid), data.listProjects(user.uid)]);
      setLib({ assets, projects });
      setDenied(false);
    } catch (e) { if (e.code === 'permission-denied') setDenied(true); else setErr(e.message); }
  }, [user]);
  useEffect(() => { setLib(null); setDenied(false); reload(); }, [reload]);

  if (!ready) return <Notice title="Chargement…" />;
  if (!user) {
    return (
      <Notice title="Review">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button onClick={() => signIn().catch((e) => setErr(e.message))}>Me connecter</button>
          {usingEmulators && <button className="ghost" onClick={() => window.__devSignIn('host@example.test').catch((e) => setErr(e.message))}>Entrer en aperçu local</button>}
        </div>
        {err && <p className="mut" style={{ marginTop: 14 }}>{err}</p>}
      </Notice>
    );
  }
  if (denied) {
    return (
      <Notice title="Accès refusé" text="Cette adresse n’a pas été invitée au club. Si on t’a invité, c’est avec une autre adresse Gmail.">
        <p className="mut">Connecté en tant que <strong style={{ color: 'var(--txt)' }}>{user.email}</strong>. <button className="link" onClick={() => switchAccount().catch(() => {})}>Changer de compte</button></p>
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
      <div className="row dashbar" style={{ justifyContent: 'space-between' }}>
        <div className="brand" style={{ margin: 0 }}><span>nocturnz</span><b>/ review</b></div>
        <div className="dash-actions"><ClubButton user={user} /><NotifyButton /><span className="mut dash-email">{user.email}</span><button className="ghost sm" onClick={signOut}>Se déconnecter</button></div>
      </div>
      <IOSGuide />
      <div className="dash-title"><span className="eyebrow">Espace de travail</span><h1>Vos reviews<span>.</span></h1></div>

      <AddAssetForm uid={user.uid} projects={lib?.projects} onDone={reload} />
      <StorageGauge />
      {lib && <ExpiredCleanup assets={lib.assets} onDone={reload} />}
      {err && <p className="mut">{err}</p>}

      {!lib && <p className="mut">Chargement…</p>}
      {lib && (
        <>
          <div className="section-title"><span>01</span><b>Projets</b></div>
          <div className="tiles">
            {lib.projects.map((p) => <ProjectTile key={p.id} p={p} assets={lib.assets.filter((a) => a.project === p.id)} uid={user.uid} onChange={reload} onDropAsset={(aid) => move(aid, p.id)} />)}
            <NewProject uid={user.uid} onDone={reload} />
          </div>

          <div className="section-title"><span>02</span><b>Sans projet</b></div>
          {dragging && lib.projects.length > 0 && <DropBar targets={lib.projects} onDropAsset={move} />}
          {loose.map((a) => <AssetCard key={a.id} a={a} projects={lib.projects} onChange={reload} onDragging={setDragging} />)}
          {!loose.length && !lib.assets.length && <p className="mut empty-line">Aucune review</p>}
        </>
      )}
    </div>
    </HostingProvider>
  );
}
