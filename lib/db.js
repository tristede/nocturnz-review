import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

mkdirSync('data', { recursive: true });
const db = (globalThis.__db ??= new DatabaseSync('data/review.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  drive_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  t REAL NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

// migrations idempotentes (phase 1 : ancrage, plage, annotations, réponses)
const have = db.prepare('PRAGMA table_info(comments)').all().map((c) => c.name);
for (const [name, ddl] of [
  ['t_end', 'REAL'], ['x', 'REAL'], ['y', 'REAL'], ['shapes', 'TEXT'], ['parent_id', 'INTEGER'],
]) if (!have.includes(name)) db.exec(`ALTER TABLE comments ADD COLUMN ${name} ${ddl}`);

const haveV = db.prepare('PRAGMA table_info(videos)').all().map((c) => c.name);
if (!haveV.includes('fps')) db.exec('ALTER TABLE videos ADD COLUMN fps REAL');
if (!haveV.includes('peaks')) db.exec('ALTER TABLE videos ADD COLUMN peaks TEXT');
export const setPeaks = (token, b64) => db.prepare('UPDATE videos SET peaks=? WHERE token=?').run(b64, token);
export const setFps = (token, fps) => db.prepare('UPDATE videos SET fps=? WHERE token=?').run(fps, token);
export const setFpsById = (id, fps) => db.prepare('UPDATE videos SET fps=? WHERE id=?').run(fps, id);

// accès Google : une seule connexion pour l'instant (le propriétaire), extensible à un compte par utilisateur
db.exec(`CREATE TABLE IF NOT EXISTS google_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  expires_at INTEGER
)`);
if (!db.prepare('PRAGMA table_info(videos)').all().some((c) => c.name === 'source'))
  db.exec("ALTER TABLE videos ADD COLUMN source TEXT NOT NULL DEFAULT 'public'");
// médias (un lien de partage) → versions (v1, v2…) → commentaires
db.exec(`CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  password TEXT,
  expires_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);
const haveV2 = db.prepare('PRAGMA table_info(videos)').all().map((c) => c.name);
for (const [name, ddl] of [
  ['asset_id', 'INTEGER'], ['version', 'INTEGER NOT NULL DEFAULT 1'],
  ['status', 'TEXT'], ['status_by', 'TEXT'], ['status_at', 'INTEGER'],
]) if (!haveV2.includes(name)) db.exec(`ALTER TABLE videos ADD COLUMN ${name} ${ddl}`);
// chaque vidéo existante devient un média à une version : son lien de partage reste valide
for (const v of db.prepare('SELECT id, title, token, created_at FROM videos WHERE asset_id IS NULL').all()) {
  const r = db.prepare('INSERT INTO assets (title, token, created_at) VALUES (?,?,?)').run(v.title, v.token, v.created_at);
  db.prepare('UPDATE videos SET asset_id=? WHERE id=?').run(r.lastInsertRowid, v.id);
}

export const getGoogleAuth = () => db.prepare('SELECT * FROM google_auth WHERE id=1').get();
export const saveGoogleAuth = ({ refresh, access, expiresAt }) =>
  db.prepare(`INSERT INTO google_auth (id, refresh_token, access_token, expires_at) VALUES (1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET refresh_token=COALESCE(excluded.refresh_token, refresh_token), access_token=excluded.access_token, expires_at=excluded.expires_at`)
    .run(refresh, access, expiresAt);
export const clearGoogleAuth = () => db.prepare('DELETE FROM google_auth').run();

export const parseYouTubeId = (input) => {
  try {
    const u = new URL(String(input).trim());
    const h = u.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      id = u.pathname === '/watch' ? u.searchParams.get('v') : u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/)?.[2];
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
};

export const parseDriveId = (input) => {
  const m = input.match(/\/d\/([\w-]{10,})/) || input.match(/[?&]id=([\w-]{10,})/) || input.match(/^([\w-]{20,})$/);
  return m?.[1] ?? null;
};

const newToken = () => randomBytes(9).toString('base64url');
const DAY = 86_400_000;

export const listAssets = () => {
  const versions = db.prepare(`SELECT v.*,
    (SELECT COUNT(*) FROM comments c WHERE c.video_id=v.id) AS n,
    (SELECT COUNT(*) FROM comments c WHERE c.video_id=v.id AND c.resolved=0 AND c.parent_id IS NULL) AS open
    FROM videos v WHERE asset_id=? ORDER BY version`);
  return db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all().map((a) => ({ ...a, versions: versions.all(a.id) }));
};
export const getAsset = (token) => db.prepare('SELECT * FROM assets WHERE token=?').get(token);
export const getAssetById = (id) => db.prepare('SELECT * FROM assets WHERE id=?').get(id);
export const getVersions = (assetId) => db.prepare('SELECT * FROM videos WHERE asset_id=? ORDER BY version').all(assetId);
export const getVideoById = (id) => db.prepare('SELECT * FROM videos WHERE id=?').get(id);

const insertVersion = (assetId, n, title, driveId, source) =>
  db.prepare('INSERT INTO videos (title, drive_id, token, source, created_at, asset_id, version) VALUES (?,?,?,?,?,?,?)')
    .run(title, driveId, newToken(), source, Date.now(), assetId, n);

// nouveau média (v1) ; le lien expire après 30 jours par défaut, réglable ensuite
export const addAsset = (title, driveId, source = 'public') => {
  const token = newToken();
  const r = db.prepare('INSERT INTO assets (title, token, expires_at, created_at) VALUES (?,?,?,?)').run(title, token, Date.now() + 30 * DAY, Date.now());
  insertVersion(r.lastInsertRowid, 1, title, driveId, source);
  return token;
};
export const addVersion = (assetId, driveId, source = 'public') => {
  const a = getAssetById(assetId);
  if (!a) return null;
  const n = db.prepare('SELECT COALESCE(MAX(version),0) AS m FROM videos WHERE asset_id=?').get(assetId).m + 1;
  insertVersion(assetId, n, a.title, driveId, source);
  return n;
};
export const deleteAsset = (id) => {
  db.prepare('DELETE FROM videos WHERE asset_id=?').run(id);
  db.prepare('DELETE FROM assets WHERE id=?').run(id);
};
export const setShare = (id, { expiresAt, password }) => {
  db.prepare('UPDATE assets SET expires_at=? WHERE id=?').run(expiresAt, id);
  if (password !== undefined) db.prepare('UPDATE assets SET password=? WHERE id=?').run(password, id);
};
export const setRevoked = (id, v) => db.prepare('UPDATE assets SET revoked=? WHERE id=?').run(v ? 1 : 0, id);
// nouveau lien : le token du média ET ceux de ses versions changent, l'ancien accès (API comprise) meurt
export const regenToken = (id) => {
  db.prepare('UPDATE assets SET token=?, revoked=0 WHERE id=?').run(newToken(), id);
  for (const v of db.prepare('SELECT id FROM videos WHERE asset_id=?').all(id)) db.prepare('UPDATE videos SET token=? WHERE id=?').run(newToken(), v.id);
};
export const setStatus = (videoId, status, by) =>
  db.prepare('UPDATE videos SET status=?, status_by=?, status_at=? WHERE id=?').run(status, status ? by : null, status ? Date.now() : null, videoId);

export const getVideo = (token) => db.prepare('SELECT * FROM videos WHERE token=?').get(token);
export const getComments = (videoId) => db.prepare('SELECT * FROM comments WHERE video_id=? ORDER BY t, id').all(videoId);
export const getComment = (id) => db.prepare('SELECT * FROM comments WHERE id=?').get(id);
export const addComment = ({ videoId, author, body, t, tEnd = null, x = null, y = null, shapes = null, parentId = null }) =>
  db.prepare('INSERT INTO comments (video_id, author, body, t, t_end, x, y, shapes, parent_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(videoId, author, body, t, tEnd, x, y, shapes, parentId, Date.now());
export const setResolved = (id, v) => db.prepare('UPDATE comments SET resolved=? WHERE id=?').run(v ? 1 : 0, id);
export const deleteComment = (id) => db.prepare('DELETE FROM comments WHERE id=? OR parent_id=?').run(id, id);
