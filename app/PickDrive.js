'use client';
import { useState } from 'react';

const loadScript = (src) => new Promise((ok, ko) => {
  if (document.querySelector(`script[src="${src}"]`)) return ok();
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = ko;
  document.head.appendChild(s);
});

export default function PickDrive({ configured, connected, assetId, compact }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/google/token', { cache: 'no-store' });
      if (!r.ok) throw new Error('Connexion Google expirée, reconnecte-toi.');
      const { token, apiKey, appId } = await r.json();
      if (!apiKey || !appId) throw new Error('GOOGLE_API_KEY ou GOOGLE_APP_ID manquant dans .env.local');
      await loadScript('https://apis.google.com/js/api.js');
      await new Promise((ok) => window.gapi.load('picker', ok));
      const g = window.google.picker;
      const view = new g.DocsView(g.ViewId.DOCS_VIDEOS).setIncludeFolders(true);
      new g.PickerBuilder()
        .addView(view).setOAuthToken(token).setDeveloperKey(apiKey).setAppId(appId).setLocale('fr')
        .setCallback(async (d) => {
          if (d.action !== g.Action.PICKED) return;
          const f = d.docs[0];
          await fetch('/api/videos', { method: 'POST', body: JSON.stringify({ fileId: f.id, name: f.name, assetId }) });
          location.reload();
        })
        .build().setVisible(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => { await fetch('/api/google/disconnect', { method: 'POST' }); location.reload(); };

  if (!configured) return compact ? null : <p className="mut">Google Drive : ajoute <code>GOOGLE_CLIENT_ID</code> et <code>GOOGLE_CLIENT_SECRET</code> dans <code>.env.local</code> pour choisir tes vidéos dans Drive.</p>;
  if (!connected) return compact ? null : <a href="/api/google/connect"><button>Connecter Google Drive</button></a>;
  return (
    <div>
      <div className="row">
        <button className={compact ? 'ghost sm' : ''} onClick={pick} disabled={busy}>{compact ? 'Choisir dans Drive' : 'Choisir une vidéo dans Drive'}</button>
        {!compact && <button className="link" style={{ padding: 0 }} onClick={disconnect}>Déconnecter Google</button>}
      </div>
      {err && <p className="mut">{err}</p>}
    </div>
  );
}
