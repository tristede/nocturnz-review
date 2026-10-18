import { useEffect, useRef } from 'react';

export default function CommentNavigation({ comments, currentId, position, onSelect }) {
  const root = useRef(null);
  const ordered = [...comments].sort((a, b) => a.t - b.t || a.created_at - b.created_at || a.id.localeCompare(b.id));
  const index = ordered.findIndex((c) => c.id === currentId);
  const prev = index >= 0 ? ordered[index - 1] : ordered.filter((c) => c.t < position - .001).at(-1);
  const next = index >= 0 ? ordered[index + 1] : ordered.find((c) => c.t >= position - .001);
  const choose = (comment) => {
    if (!comment) return;
    onSelect(comment);
    requestAnimationFrame(() => {
      const list = root.current?.closest('aside')?.querySelector('.list');
      const row = list && [...list.children].find((node) => node.dataset.commentId === comment.id);
      if (row && list.scrollHeight > list.clientHeight) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 16;
    });
  };
  const latest = useRef(null); latest.current = { prev, next, choose };
  useEffect(() => {
    const key = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); const state = latest.current; state.choose(e.key === 'ArrowUp' ? state.prev : state.next);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return <div className="comment-navigation" ref={root} role="group" aria-label="Parcourir les commentaires">
    <button className="ghost icon" disabled={!prev} aria-label="Commentaire précédent" title="Commentaire précédent · Alt + ↑" onClick={() => choose(prev)}>↑</button>
    <span className="mut" aria-live="polite">{index >= 0 ? `${index + 1}/${ordered.length}` : ordered.length}</span>
    <button className="ghost icon" disabled={!next} aria-label="Commentaire suivant" title="Commentaire suivant · Alt + ↓" onClick={() => choose(next)}>↓</button>
  </div>;
}
