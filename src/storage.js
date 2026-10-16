// Stockage des fichiers importés : un espace compatible S3 propre à chaque hôte (Cloudflare R2 d'abord,
// puis tout service S3 ou un NAS). Le navigateur de l'hôte signe lui-même ses requêtes avec une clé limitée
// à son espace : aucun serveur entre les deux. Les clients, eux, lisent les fichiers par l'adresse publique.
import { AwsClient } from 'aws4fetch';

const PART = 32 * 1024 * 1024;   // R2 exige des morceaux de même taille (sauf le dernier)
const SINGLE_MAX = 64 * 1024 * 1024;
const PARALLEL = 3;

export const GB = 1e9;
export const fmtGB = (b) => (b < GB ? `${Math.max(b > 0 ? 1 : 0, Math.round(b / 1e6))} Mo` : `${(b / GB).toFixed(b < 10 * GB ? 1 : 0).replace('.', ',')} Go`);

const enc = (key) => key.split('/').map(encodeURIComponent).join('/');
const trim = (s) => s.replace(/\/+$/, '');
export const publicUrl = (h, key) => `${trim(h.publicBase)}/${enc(key)}`;
export const r2Endpoint = (accountId) => `https://${accountId.trim()}.r2.cloudflarestorage.com`;

function client(h) {
  const aws = new AwsClient({ accessKeyId: h.accessKeyId, secretAccessKey: h.secretAccessKey, service: 's3', region: h.region || 'auto' });
  const base = `${trim(h.endpoint)}/${encodeURIComponent(h.bucket)}`;
  // en-têtes signés ; le contenu n'est pas haché (UNSIGNED-PAYLOAD), sinon il faudrait relire chaque morceau
  const sign = (url, method, headers = {}) => aws.sign(url, { method, headers: { 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', ...headers } });
  return { base, sign };
}

// messages lisibles pour les erreurs les plus probables (clé fausse, règle CORS absente, espace inconnu)
function explain(status, text = '') {
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1];
  if (status === 0) return 'Le stockage ne répond pas au navigateur : la règle CORS de l’espace manque ou ne contient pas l’adresse de ce site.';
  if (status === 403 || code === 'SignatureDoesNotMatch' || code === 'InvalidAccessKeyId') return 'Clé refusée : vérifie l’identifiant et le secret de la clé, et qu’elle a le droit d’écrire dans cet espace.';
  if (status === 404 || code === 'NoSuchBucket') return 'Espace introuvable : vérifie le nom du bucket et l’adresse du stockage.';
  return `Le stockage a répondu ${status}${code ? ` (${code})` : ''}.`;
}

async function call(h, method, path, { query = '', headers, body } = {}) {
  const { base, sign } = client(h);
  const req = await sign(`${base}${path ? `/${enc(path)}` : ''}${query ? `?${query}` : ''}`, method, headers);
  let r;
  try { r = await fetch(req.url, { method, headers: req.headers, body }); } catch { throw new Error(explain(0)); }
  const text = await r.text();
  if (!r.ok) throw new Error(explain(r.status, text));
  return { text, headers: r.headers };
}

// envoi avec avancement : XHR (fetch ne donne pas la progression d'un envoi)
async function put(h, path, query, blob, headers, onBytes, signal) {
  const { base, sign } = client(h);
  const req = await sign(`${base}/${enc(path)}${query ? `?${query}` : ''}`, 'PUT', headers);
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest();
    x.open('PUT', req.url);
    req.headers.forEach((v, k) => { if (k !== 'host' && k !== 'content-length') x.setRequestHeader(k, v); });
    x.upload.onprogress = (e) => onBytes?.(e.loaded);
    x.onload = () => (x.status >= 200 && x.status < 300 ? ok(x.getResponseHeader('ETag')) : ko(new Error(explain(x.status, x.responseText))));
    x.onerror = () => ko(new Error(explain(0)));
    x.onabort = () => ko(Object.assign(new Error('Import annulé.'), { aborted: true }));
    signal?.addEventListener('abort', () => x.abort(), { once: true });
    x.send(blob);
  });
}

/** Place occupée dans l'espace : { bytes, count } */
export async function usage(h) {
  let bytes = 0, count = 0, token = null;
  do {
    const q = `list-type=2&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
    const { text } = await call(h, 'GET', '', { query: q });
    for (const m of text.matchAll(/<Size>(\d+)<\/Size>/g)) { bytes += Number(m[1]); count++; }
    token = /<IsTruncated>true<\/IsTruncated>/.test(text) ? text.match(/<NextContinuationToken>([^<]+)</)?.[1] : null;
  } while (token);
  return { bytes, count };
}

export const removeObject = (h, key) => call(h, 'DELETE', key).catch(() => {});

/**
 * Envoie un fichier ; gros fichiers en plusieurs morceaux (3 en parallèle, 3 essais chacun).
 * onProgress(0..1), signal = AbortSignal pour annuler.
 */
export async function uploadFile(h, key, file, { onProgress, signal, contentType } = {}) {
  const type = contentType || file.type || 'application/octet-stream';
  if (file.size <= SINGLE_MAX) {
    await put(h, key, '', file, { 'content-type': type }, (b) => onProgress?.(b / file.size), signal);
    onProgress?.(1);
    return;
  }
  const { text } = await call(h, 'POST', key, { query: 'uploads', headers: { 'content-type': type } });
  const uploadId = text.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  if (!uploadId) throw new Error('Le stockage n’a pas ouvert l’envoi en plusieurs morceaux.');
  const parts = Math.ceil(file.size / PART);
  const sent = new Array(parts).fill(0);
  const etags = new Array(parts);
  const report = () => onProgress?.(sent.reduce((a, b) => a + b, 0) / file.size);
  let next = 0;
  const worker = async () => {
    while (next < parts) {
      const i = next++;
      const blob = file.slice(i * PART, Math.min(file.size, (i + 1) * PART));
      for (let tryN = 1; ; tryN++) {
        try {
          const etag = await put(h, key, `partNumber=${i + 1}&uploadId=${encodeURIComponent(uploadId)}`, blob, {}, (b) => { sent[i] = b; report(); }, signal);
          if (!etag) throw new Error('ETag absent : ajoute « ETag » aux en-têtes exposés de la règle CORS.');
          etags[i] = etag; sent[i] = blob.size; report();
          break;
        } catch (e) {
          if (e.aborted || tryN >= 3 || /CORS|ETag|Clé/.test(e.message)) throw e;
        }
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL, parts) }, worker));
    const xml = `<CompleteMultipartUpload>${etags.map((t, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${t}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    await call(h, 'POST', key, { query: `uploadId=${encodeURIComponent(uploadId)}`, headers: { 'content-type': 'application/xml' }, body: xml });
  } catch (e) {
    call(h, 'DELETE', key, { query: `uploadId=${encodeURIComponent(uploadId)}` }).catch(() => {}); // libère les morceaux déjà envoyés
    throw e;
  }
}

/** Vérifie tout le circuit : liste, écriture, lecture publique, suppression. Renvoie la place occupée. */
export async function testConnection(h) {
  const key = '.review-test.txt';
  const u = await usage(h);
  await put(h, key, '', new Blob(['ok'], { type: 'text/plain' }), { 'content-type': 'text/plain' });
  let publicOk = false;
  try { const r = await fetch(`${publicUrl(h, key)}?t=${Date.now()}`, { cache: 'no-store' }); publicOk = r.ok && (await r.text()) === 'ok'; } catch {}
  await removeObject(h, key);
  if (!publicOk) throw new Error('Envoi réussi, mais l’adresse publique ne renvoie pas le fichier : vérifie l’adresse publique (r2.dev activé ?) et la règle CORS (GET).');
  return u;
}

// règle CORS à coller dans l'espace de stockage
export const corsRule = (origins) => JSON.stringify([{
  AllowedOrigins: origins,
  AllowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['ETag', 'Content-Length', 'Content-Range', 'Accept-Ranges'],
  MaxAgeSeconds: 3600,
}], null, 2);
