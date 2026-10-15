import { getVideo, getComments } from '@/lib/db';
import { isAdmin } from '@/lib/auth';

// timecode non-drop-frame : on compte les images au vrai fps, on les affiche sur la base nominale (29.97 -> 30)
const makeTc = (fps) => (s) => {
  const base = Math.round(fps), f = Math.round(s * fps), p = (n) => String(n).padStart(2, '0');
  const sec = Math.floor(f / base);
  return `${p(Math.floor(sec / 3600))}:${p(Math.floor(sec / 60) % 60)}:${p(sec % 60)}:${p(f % base)}`;
};

// CSV tabulé au format d'export de markers Premiere Pro
export async function GET(req, { params }) {
  if (!(await isAdmin())) return new Response('forbidden', { status: 403 });
  const v = getVideo((await params).token);
  if (!v) return new Response('Not found', { status: 404 });
  const tc = makeTc(v.fps || 25);
  const all = getComments(v.id);
  const rows = all.filter((c) => !c.parent_id).map((c) => {
    const replies = all.filter((r) => r.parent_id === c.id).map((r) => ` | ${r.author}: ${r.body}`).join('');
    const out = c.t_end ?? c.t;
    const dur = Math.max(0, out - c.t);
    return [c.author, (c.body + replies).replace(/\s+/g, ' '), tc(c.t), tc(out), tc(dur), 'Comment'].join('\t');
  });
  const out = ['Marker Name\tDescription\tIn\tOut\tDuration\tMarker Type', ...rows].join('\n');
  return new Response(out, { headers: {
    'Content-Type': 'text/tab-separated-values; charset=utf-8',
    'Content-Disposition': `attachment; filename="${v.title.replace(/[^\w-]+/g, '_')}-markers.csv"` } });
}
