// Éléments partagés par les deux lecteurs (vidéo et pages) : formes dessinées, outils, icônes.
export const COLORS = ['#ff4d4d', '#ffb020', '#3ecf8e', '#4da3ff', '#ffffff'];
export const TOOLS = [['arrow', 'Flèche'], ['pen', 'Crayon'], ['circle', 'Cercle'], ['rect', 'Rectangle'], ['pin', 'Repère']];
export const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));

export const parse = (c) => ({ ...c, shapes: c.shapes ? JSON.parse(c.shapes) : null });
export const hasMarks = (c) => !!c.shapes?.length || c.x != null;

// dessine une forme normalisée (0..1) ; `box` sert à calculer la tête de flèche en pixels
export function Shape({ s, box }) {
  const common = { stroke: s.c, strokeWidth: 3, fill: 'none', vectorEffect: 'non-scaling-stroke', strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (s.t === 'pen') return <polyline {...common} points={s.p.map((p) => p.join(',')).join(' ')} />;
  const [ax, ay] = s.a, [bx, by] = s.b;
  if (s.t === 'rect') return <rect {...common} x={Math.min(ax, bx)} y={Math.min(ay, by)} width={Math.abs(bx - ax)} height={Math.abs(by - ay)} />;
  if (s.t === 'circle') return <ellipse {...common} cx={(ax + bx) / 2} cy={(ay + by) / 2} rx={Math.abs(bx - ax) / 2} ry={Math.abs(by - ay) / 2} />;
  const w = box.w || 1, h = box.h || 1;
  const ang = Math.atan2((by - ay) * h, (bx - ax) * w);
  const head = [-0.45, 0.45].map((d) => [bx - (Math.cos(ang + d) * 16) / w, by - (Math.sin(ang + d) * 16) / h]);
  return <polyline {...common} points={`${ax},${ay} ${bx},${by} ${head[0].join(',')} ${bx},${by} ${head[1].join(',')}`} />;
}

export const toShape = (d) =>
  d.type === 'pen'
    ? { t: 'pen', c: d.c, p: d.pts.filter((_, i) => i % 2 === 0 || i === d.pts.length - 1) }
    : { t: d.type, c: d.c, a: d.a, b: d.b };

export const IconPlay = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d="M8 5.4v13.2c0 .5.5.8.9.5l10.2-6.6a.6.6 0 0 0 0-1L8.9 4.9a.6.6 0 0 0-.9.5z" fill="currentColor" /></svg>;
export const IconPause = () => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><rect x="6.5" y="5" width="3.8" height="14" rx="1" fill="currentColor" /><rect x="13.7" y="5" width="3.8" height="14" rx="1" fill="currentColor" /></svg>;
export const IconChevron = ({ dir }) => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden><path d={dir === 'left' ? 'M14.5 6l-6 6 6 6' : 'M9.5 6l6 6-6 6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
