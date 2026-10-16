// Réglage de l'hébergement des fichiers importés : un espace compatible S3 propre à l'hôte (Cloudflare R2 d'abord).
// Les clés sont rangées dans son profil, lisibles par lui seul (règles Firestore), et ne servent qu'à son navigateur.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import * as data from './data';
import Notice from './Notice';
import { GB, corsRule, fmtGB, r2Endpoint, testConnection } from './storage';

const ORIGINS = ['https://nocturnz-review.web.app', 'https://nocturnz-review.firebaseapp.com', 'https://review.nocturnz.xyz', 'http://localhost:3100'];
const R2_FREE = 10 * GB;

// identifiant de compte Cloudflare à partir d'une adresse r2.cloudflarestorage.com
const accountOf = (endpoint = '') => endpoint.match(/^https:\/\/([a-f0-9]{32})\.r2\.cloudflarestorage\.com/)?.[1] || '';

export default function HostingPage() {
  const { user, ready } = useAuth();
  const [h, setH] = useState(null);       // valeurs du formulaire
  const [saved, setSaved] = useState(null);
  const [msg, setMsg] = useState({ text: '', ok: false });
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!user) return;
    data.loadHosting(user.uid)
      .then((cur) => {
        setSaved(cur);
        setH(cur ? { ...cur, accountId: accountOf(cur.endpoint), limitGB: String(cur.limitBytes / GB).replace('.', ',') }
          : { provider: 'r2', accountId: '', endpoint: '', region: 'auto', bucket: '', accessKeyId: '', secretAccessKey: '', publicBase: '', limitGB: '9,5' });
      })
      .catch((e) => { if (e.code === 'permission-denied') setDenied(true); else setMsg({ text: e.message }); });
  }, [user]);

  if (!ready) return <Notice title="Chargement…" />;
  if (!user || denied) return <Notice title="Hébergement" text="Réservé aux comptes qui créent des reviews."><Link to="/">Retour</Link></Notice>;
  if (!h) return <Notice title="Chargement…" />;

  const set = (k) => (e) => setH({ ...h, [k]: e.target.value });
  const isR2 = h.provider === 'r2';
  // valeurs prêtes à enregistrer (ou une erreur lisible)
  const build = () => {
    const limit = Number(String(h.limitGB).replace(',', '.')) * GB;
    const endpoint = isR2 ? (h.accountId.trim() ? r2Endpoint(h.accountId) : '') : h.endpoint.trim();
    const out = {
      provider: h.provider, endpoint, region: isR2 ? 'auto' : (h.region.trim() || 'us-east-1'),
      bucket: h.bucket.trim(), accessKeyId: h.accessKeyId.trim(), secretAccessKey: h.secretAccessKey.trim(),
      publicBase: h.publicBase.trim().replace(/\/+$/, ''), limitBytes: limit,
    };
    if (!/^https:\/\/.+/.test(out.endpoint)) throw new Error(isR2 ? 'Indique l’identifiant de compte Cloudflare (32 caractères).' : 'Indique l’adresse du stockage (https://…).');
    if (!out.bucket || !out.accessKeyId || !out.secretAccessKey) throw new Error('Il manque le nom de l’espace ou la clé (identifiant + secret).');
    if (!/^https?:\/\/.+/.test(out.publicBase)) throw new Error('Indique l’adresse publique de l’espace (https://…).');
    if (!(limit > 0)) throw new Error('Indique une limite en Go.');
    return out;
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg({ text: '' });
    try {
      const out = build();
      setMsg({ text: 'Test de la connexion…' });
      const u = await testConnection(out);
      await data.saveHosting(user.uid, out);
      setSaved(out);
      setMsg({ text: `C’est branché. ${fmtGB(u.bytes)} déjà utilisés sur ${fmtGB(out.limitBytes)}.`, ok: true });
    } catch (ex) { setMsg({ text: ex.message }); } finally { setBusy(false); }
  };
  const unplug = async () => {
    if (!confirm('Débrancher cet hébergement ? Les fichiers déjà importés restent dans ton espace et restent lisibles ; seuls les nouveaux imports seront impossibles.')) return;
    await data.deleteHosting(user.uid);
    setSaved(null);
    setMsg({ text: 'Hébergement débranché.' });
  };
  const limitNum = Number(String(h.limitGB).replace(',', '.')) * GB;
  const cors = corsRule(ORIGINS);
  const copy = (t) => { try { navigator.clipboard.writeText(t); setMsg({ text: 'Copié.', ok: true }); } catch {} };

  return (
    <div className="wrap">
      <Link className="eyebrow back" to="/">← Vos reviews</Link>
      <h1 style={{ marginTop: 8 }}>Hébergement</h1>
      <p className="mut" style={{ maxWidth: '62ch', marginTop: -14 }}>
        Les fichiers que tu importes vont dans ton propre espace de stockage. L’outil n’y garde rien : ta clé reste dans ton profil, lisible par toi seul.
        La jauge bloque les imports avant la limite que tu choisis.
      </p>

      <form className="card hosting-form" onSubmit={save}>
        <div className="seg-ctl" role="group" aria-label="Fournisseur">
          <button type="button" className={isR2 ? 'on' : ''} onClick={() => setH({ ...h, provider: 'r2' })}>Cloudflare R2</button>
          <button type="button" className={!isR2 ? 'on' : ''} onClick={() => setH({ ...h, provider: 's3' })}>Autre stockage S3 / NAS</button>
        </div>

        {isR2 ? (
          <label className="field"><span className="lbl">Identifiant de compte Cloudflare</span>
            <input value={h.accountId} onChange={set('accountId')} placeholder="32 caractères, visible sur la page R2" autoComplete="off" spellCheck={false} /></label>
        ) : (
          <div className="field-row">
            <label className="field"><span className="lbl">Adresse du stockage (S3)</span>
              <input value={h.endpoint} onChange={set('endpoint')} placeholder="https://s3.exemple.com" autoComplete="off" spellCheck={false} /></label>
            <label className="field" style={{ maxWidth: 180 }}><span className="lbl">Région</span>
              <input value={h.region} onChange={set('region')} placeholder="us-east-1" autoComplete="off" /></label>
          </div>
        )}
        <label className="field"><span className="lbl">Nom de l’espace (bucket)</span>
          <input value={h.bucket} onChange={set('bucket')} placeholder="review" autoComplete="off" spellCheck={false} /></label>
        <div className="field-row">
          <label className="field"><span className="lbl">Clé : identifiant (Access Key ID)</span>
            <input value={h.accessKeyId} onChange={set('accessKeyId')} autoComplete="off" spellCheck={false} /></label>
          <label className="field"><span className="lbl">Clé : secret (Secret Access Key)</span>
            <input type="password" value={h.secretAccessKey} onChange={set('secretAccessKey')} autoComplete="new-password" spellCheck={false} /></label>
        </div>
        <label className="field"><span className="lbl">Adresse publique de l’espace</span>
          <input value={h.publicBase} onChange={set('publicBase')} placeholder={isR2 ? 'https://pub-xxxx.r2.dev' : 'https://…'} autoComplete="off" spellCheck={false} /></label>
        <label className="field" style={{ maxWidth: 220 }}><span className="lbl">Limite (Go)</span>
          <input value={h.limitGB} onChange={set('limitGB')} inputMode="decimal" /></label>
        {isR2 && limitNum > R2_FREE && <p className="mut warn">Au-delà de 10 Go, Cloudflare facture le stockage (environ 0,015 $ par Go et par mois).</p>}

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button disabled={busy}>{busy ? 'Test…' : saved ? 'Tester et enregistrer' : 'Tester et brancher'}</button>
          {saved && <button type="button" className="ghost sm" onClick={unplug}>Débrancher</button>}
          {msg.text && <span className={`mut ${msg.ok ? 'okmsg' : 'warn'}`}>{msg.text}</span>}
        </div>
      </form>

      <details className="card guide" open={!saved}>
        <summary><strong>Mise en place sur Cloudflare R2</strong> <span className="mut">(une seule fois, environ 10 minutes)</span></summary>
        <ol>
          <li>Sur <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">dash.cloudflare.com</a>, ouvre <b>R2 Object Storage</b> et active-le (Cloudflare demande une carte ; rien n’est prélevé sous 10 Go).</li>
          <li><b>Create bucket</b> : nomme-le par exemple <code>review</code>, emplacement automatique.</li>
          <li>Dans le bucket, onglet <b>Settings</b> → <b>Public Development URL</b> → <b>Enable</b>. Copie l’adresse <code>https://pub-….r2.dev</code> dans « Adresse publique ».</li>
          <li>Toujours dans <b>Settings</b> → <b>CORS Policy</b> → <b>Add CORS policy</b>, colle cette règle :
            <pre className="code">{cors}</pre>
            <button type="button" className="ghost sm" onClick={() => copy(cors)}>Copier la règle</button>
          </li>
          <li>Retour à la page R2 → <b>Manage API tokens</b> (ou « API » → « Manage API tokens ») → <b>Create API token</b> : permission <b>Object Read &amp; Write</b>, limitée à <b>ce bucket seulement</b>. Copie l’<b>Access Key ID</b> et le <b>Secret Access Key</b> (le secret ne s’affiche qu’une fois).</li>
          <li>L’<b>identifiant de compte</b> est affiché sur la page R2 (Account ID, 32 caractères).</li>
          <li>Remplis le formulaire ci-dessus et clique « Tester et brancher » : l’outil envoie et relit un petit fichier pour vérifier tout le circuit.</li>
        </ol>
      </details>
    </div>
  );
}
