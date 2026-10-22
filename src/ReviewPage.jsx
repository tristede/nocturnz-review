import { useEffect, useRef, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { loadProject, loadReview, setProjectDeadline, subscribeProject } from './data';
import ProjectDeadline, { DeadlineBadge } from './ProjectDeadline';
import Review from './Review';
import StillReview from './StillReview';
import Notice from './Notice';

export default function ReviewPage() {
  const { token } = useParams();
  const route = useLocation();
  const [sp] = useSearchParams();
  const { user, ready, signIn, signOut, switchAccount } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const loaded = useRef(false);
  const v = sp.get('v');

  // on recharge à chaque changement de compte ou de version (pour voir les validations à jour)
  useEffect(() => {
    if (!ready) return;
    let dead = false;
    if (!loaded.current) setState({ status: 'loading' });
    loadReview(token)
      .then(async (r) => {
        // retour vers le projet si on peut l'ouvrir (hôte, ou invité venu par le lien du projet)
        const project = r.asset.project ? await loadProject(r.asset.project).catch(() => null) : null;
        if (!dead) { loaded.current = true; setState({ status: 'ok', ...r, project }); }
      })
      .catch((e) => { if (!dead) { loaded.current = false; setState({ status: e.code === 'not-found' ? 'missing' : 'denied' }); } });
    return () => { dead = true; };
  }, [token, ready, user?.uid, v]);
  const projectId = state.project?.id;
  useEffect(() => {
    if (!projectId) return;
    return subscribeProject(projectId, (project) => setState((s) => s.status === 'ok' ? { ...s, project } : s), () => setState((s) => ({ ...s, project: null })));
  }, [projectId]);

  if (state.status === 'loading') return <Notice title="Chargement…" />;
  if (state.status === 'missing') return <Notice title="Review introuvable" text="Ce lien ne correspond à aucune review." />;
  if (state.status === 'denied') {
    return (
      <Notice
        title="Accès impossible"
        text="Cette review est désactivée, expirée, ou réservée à des invités. Si on t’a invité, connecte-toi avec l’adresse Gmail invitée."
      >
        {user ? (
          <p className="mut">Connecté en tant que <strong style={{ color: 'var(--txt)' }}>{user.email}</strong>. <button className="link" onClick={() => switchAccount().catch(() => {})}>Changer de compte</button></p>
        ) : (
          <button onClick={() => signIn().catch(() => {})}>Se connecter avec Google</button>
        )}
      </Notice>
    );
  }

  const { asset, versions, project } = state;
  const admin = !!user && asset.owner === user.uid;
  const deadline = project ? <div className="review-deadline">{user?.uid === project.owner
    ? <ProjectDeadline value={project.dueDate} onSave={(date) => setProjectDeadline(project.id, date)} />
    : project.dueDate ? <DeadlineBadge value={project.dueDate} label /> : <span className="mut">Échéance · non définie</span>}</div> : null;
  const back = project && (admin || route.state?.fromProject === project.id) ? { to: `/p/${project.id}`, label: project.name } : admin ? { to: '/', label: 'Vos reviews' } : null;
  const latest = versions[versions.length - 1];
  const current = versions.find((x) => String(x.n) === v) || latest;
  const cmp = versions.find((x) => String(x.n) === sp.get('cmp') && x.n !== current.n)?.n ?? null;
  if (current.kind && current.kind !== 'video') {
    return (
      <StillReview
        key={`${token}:${current.n}`}
        aid={token}
        title={asset.title}
        admin={admin}
        back={back}
        deadline={deadline}
        version={current}
        versions={versions.map((x) => ({ n: x.n, status: x.status }))}
        currentN={current.n}
        latestN={latest.n}
        initialStatus={current.status ? { status: current.status, by: current.statusBy, at: current.statusAt } : null}
      />
    );
  }
  return (
    <Review
      key={`${token}:${current.n}`}
      aid={token}
      title={asset.title}
      admin={admin}
      back={back}
      deadline={deadline}
      initialFps={current.fps}
      initialPeaks={current.peaks}
      initialPeakMax={current.peakMax ?? null}
      source={current.source}
      videoId={current.videoId}
      mediaUrl={current.url || null}
      download={current.download || null}
      fileBytes={current.size || null}
      versions={versions.map((x) => ({ n: x.n, status: x.status, source: x.source, videoId: x.videoId, kind: x.kind || 'video', url: x.url || null }))}
      currentN={current.n}
      latestN={latest.n}
      initialStatus={current.status ? { status: current.status, by: current.statusBy, at: current.statusAt } : null}
      initialCompare={cmp}
    />
  );
}
