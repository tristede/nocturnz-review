import { getComments, getComment, addComment, setResolved, deleteComment, getVideoById, getAssetById } from '@/lib/db';
import { isAdmin } from '@/lib/auth';
import { requireVideo, accessState } from '@/lib/access';

export const dynamic = 'force-dynamic';

const num = (n) => typeof n === 'number' && Number.isFinite(n);
const r4 = (n) => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4;
const pt = (p) => Array.isArray(p) && p.length === 2 && p.every(num) ? [r4(p[0]), r4(p[1])] : null;

// ne garde que des formes bien formées (le client est non fiable)
function cleanShapes(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const s of input.slice(0, 30)) {
    if (!s || !/^#[0-9a-f]{6}$/i.test(s.c)) continue;
    if (s.t === 'pen' && Array.isArray(s.p)) {
      const p = s.p.slice(0, 600).map(pt).filter(Boolean);
      if (p.length > 1) out.push({ t: 'pen', c: s.c, p });
    } else if (['arrow', 'rect', 'circle'].includes(s.t)) {
      const a = pt(s.a), b = pt(s.b);
      if (a && b) out.push({ t: s.t, c: s.c, a, b });
    }
  }
  return out.length ? JSON.stringify(out) : null;
}

export async function GET(req) {
  const { video, error } = await requireVideo(new URL(req.url).searchParams.get('token'));
  if (error) return error;
  return Response.json(getComments(video.id));
}

export async function POST(req) {
  const { token, author, body, t, t_end, x, y, shapes, parent_id } = await req.json();
  const { video: v, error } = await requireVideo(token);
  if (error) return error;
  if (!body?.trim() || !author?.trim()) return Response.json({ error: 'bad' }, { status: 400 });

  let parent = null;
  if (parent_id) {
    parent = getComment(Number(parent_id));
    if (!parent || parent.video_id !== v.id || parent.parent_id) return Response.json({ error: 'bad parent' }, { status: 400 });
  }
  const tt = parent ? parent.t : t;
  if (!num(tt) || tt < 0) return Response.json({ error: 'bad time' }, { status: 400 });

  addComment({
    videoId: v.id,
    author: author.trim().slice(0, 60),
    body: body.trim().slice(0, 2000),
    t: tt,
    tEnd: !parent && num(t_end) && t_end > tt ? t_end : null,
    x: !parent && num(x) && num(y) ? r4(x) : null,
    y: !parent && num(x) && num(y) ? r4(y) : null,
    shapes: parent ? null : cleanShapes(shapes),
    parentId: parent ? parent.id : null,
  });
  return Response.json({ ok: true });
}

export async function PATCH(req) {
  const { id, resolved } = await req.json();
  const c = getComment(Number(id));
  const v = c && getVideoById(c.video_id);
  const asset = v && getAssetById(v.asset_id);
  if (!asset) return Response.json({ error: 'not found' }, { status: 404 });
  if ((await accessState(asset)) !== 'ok') return Response.json({ error: 'forbidden' }, { status: 403 });
  setResolved(c.id, resolved);
  return Response.json({ ok: true });
}

export async function DELETE(req) {
  if (!(await isAdmin())) return Response.json({ error: 'forbidden' }, { status: 403 });
  deleteComment(Number(new URL(req.url).searchParams.get('id')));
  return Response.json({ ok: true });
}
