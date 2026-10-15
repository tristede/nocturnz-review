import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { loadReview } from './data';
import Review from './Review';
import Notice from './Notice';

export default function ReviewPage() {
  const { token } = useParams();
  const [sp] = useSearchParams();
  const { user, ready, signIn, signOut } = useAuth();
  const [state, setState] = useState({ status: 'loading' });
  const loaded = useRef(false);
  const v = sp.get('v');

  // on recharge à chaque changement de compte ou de version (pour voir les validations à jour)
  useEffect(() => {
    if (!ready) return;
    let dead = false;
    if (!loaded.current) setState({ status: 'loading' });
    loadReview(token)
      .then((r) => { if (!dead) { loaded.current = true; setState({ status: 'ok', ...r }); } })
      .catch((e) => { if (!dead) { loaded.current = false; setState({ status: e.code === 'not-found' ? 'missing' : 'denied' }); } });
    return () => { dead = true; };
  }, [token, ready, user?.uid, v]);

  if (state.status === 'loading') return <Notice title="Chargement…" />;
  if (state.status === 'missing') return <Notice title="Review introuvable" text="Ce lien ne correspond à aucune review." />;
  if (state.status === 'denied') {
    return (
      <Notice
        title="Accès impossible"
        text="Cette review est désactivée, expirée, ou réservée à des invités. Si on t’a invité, connecte-toi avec l’adresse Gmail invitée."
      >
        {user ? (
          <p className="mut">Connecté en tant que <strong style={{ color: 'var(--txt)' }}>{user.email}</strong>. <button className="link" onClick={signOut}>Changer de compte</button></p>
        ) : (
          <button onClick={() => signIn().catch(() => {})}>Se connecter avec Google</button>
        )}
      </Notice>
    );
  }

  const { asset, versions } = state;
  const latest = versions[versions.length - 1];
  const current = versions.find((x) => String(x.n) === v) || latest;
  const cmp = versions.find((x) => String(x.n) === sp.get('cmp') && x.n !== current.n)?.n ?? null;
  return (
    <Review
      key={`${token}:${current.n}`}
      aid={token}
      title={asset.title}
      admin={!!user && asset.owner === user.uid}
      initialFps={current.fps}
      initialPeaks={current.peaks}
      source={current.source}
      videoId={current.videoId}
      versions={versions.map((x) => ({ n: x.n, status: x.status, source: x.source, videoId: x.videoId }))}
      currentN={current.n}
      latestN={latest.n}
      initialStatus={current.status ? { status: current.status, by: current.statusBy, at: current.statusAt } : null}
      initialCompare={cmp}
    />
  );
}
