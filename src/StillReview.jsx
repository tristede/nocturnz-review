// Review d'un fichier « page par page » : image, SVG, Photoshop, PDF, Word, Google Docs.
// Même principe que la vidéo, la page remplace l'image : un commentaire, son repère et ses dessins
// appartiennent à une page (champ t = numéro de page, à partir de 0).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import CommentNavigation from './CommentNavigation';
import DrawingToolbar from './DrawingToolbar';
import * as data from './data';
import { notifyHost } from './push';
import { KIND_LABEL } from './links';
import { openStill } from './stills';
import { COLORS, clamp, parse, hasMarks, Shape, toShape, IconChevron } from './draw';

const ZOOMS = [1, 1.5, 2, 3, 4];

// une page : image, ou page de document déplacée dans le cadre
function PageContent({ pg, scale }) {
  const holder = useRef(null);
  useLayoutEffect(() => {
    if (!pg?.el || !holder.current) return;
    holder.current.replaceChildren(pg.el);
  }, [pg]);
  if (!pg) return null;
  if (pg.src) return <img src={pg.src} alt="" draggable={false} />;
  return <div className="docpage" ref={holder} style={{ width: pg.w, height: pg.h, transform: `scale(${scale})` }} />;
}

export default function StillReview({ aid, title, admin, back = null, deadline = null, version, versions = [], currentN = 1, latestN = 1, initialStatus = null }) {
  const navigate = useNavigate();
  const [approval, setApproval] = useState(initialStatus);
  const [needName, setNeedName] = useState(false);
  const [doc, setDoc] = useState(null);       // { count, page(i), destroy }
  const [loadErr, setLoadErr] = useState('');
  const [page, setPage] = useState(0);
  const [pg, setPg] = useState(null);         // page affichée : { src | el, w, h }
  const [fitBox, setFitBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pro, setPro] = useState(false);
  const stage = useRef(null);

  const [comments, setComments] = useState([]);
  const [name, setName] = useState('');
  const [nameOk, setNameOk] = useState(false);
  const [editName, setEditName] = useState(false);
  const [sel, setSel] = useState(null);
  const [body, setBody] = useState('');
  const [stampP, setStampP] = useState(0);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tool, setTool] = useState(null);
  const [color, setColor] = useState(COLORS[0]);
  const [pin, setPin] = useState(null);
  const [shapes, setShapes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [status, setStatus] = useState('all');
  const [author, setAuthor] = useState('');
  const [q, setQ] = useState('');

  // --- ouverture du fichier ---
  useEffect(() => {
    let dead = false, opened = null;
    setDoc(null); setLoadErr(''); setPage(0); setPg(null);
    openStill(version)
      .then((d) => { if (dead) d.destroy(); else { opened = d; setDoc(d); } })
      .catch((e) => { if (!dead) setLoadErr(e.message || 'Fichier illisible.'); });
    return () => { dead = true; opened?.destroy(); };
  }, [version]);

  useEffect(() => {
    if (!doc) return;
    let dead = false;
    // on n'affiche jamais une autre page que celle demandée (sinon ses dessins tomberaient sur la mauvaise page)
    setPg((cur) => (cur?.i === page ? cur : null));
    doc.page(page).then((p) => {
      if (dead) return;
      setPg({ ...p, i: page });
      if (page + 1 < doc.count) doc.page(page + 1).catch(() => {}); // page suivante préparée à l'avance
    }).catch(() => { if (!dead) setLoadErr('Cette page n’a pas pu être affichée.'); });
    return () => { dead = true; };
  }, [doc, page]);

  useEffect(() => data.subscribeComments(aid, currentN, (list) => setComments(list.map(parse)), () => {}), [aid, currentN]);

  useEffect(() => {
    try {
      const n = localStorage.getItem('review-name') || '';
      setName(n); setNameOk(!!n);
      setPro(localStorage.getItem('review-pro') === '1');
    } catch {}
  }, []);
  const togglePro = () => { try { localStorage.setItem('review-pro', pro ? '0' : '1'); } catch {} setPro(!pro); };

  // lien direct vers un commentaire (?c=…) : on ouvre sa page
  useEffect(() => {
    const c = new URLSearchParams(location.search).get('c');
    const hit = c && comments.find((x) => x.id === c);
    if (hit) { setSel(hit.id); setPage(Math.round(hit.t)); }
  }, [comments]);

  // taille du cadre : la page entière tient à l'écran ; une page très haute (capture, Word) se lit en largeur
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const calc = () => setFitBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }));
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = pg && fitBox.w ? (pg.h / pg.w > 1.8 ? (fitBox.w - 24) / pg.w : Math.min((fitBox.w - 24) / pg.w, (fitBox.h - 24) / pg.h)) : 0;
  const scale = fit * zoom;
  const box = pg ? { w: pg.w * scale, h: pg.h * scale } : { w: 0, h: 0 };

  const count = doc?.count || 1;
  const go = useCallback((p) => setPage((cur) => clamp(typeof p === 'function' ? p(cur) : p, 0, (doc?.count || 1) - 1)), [doc]);

  // --- brouillon : il suit la page tant qu'il est vide ---
  const drawing = shapes.length > 0 || !!pin || !!draft;
  useEffect(() => { if (!drawing && !body.trim()) setStampP(page); }, [page, drawing, body]);
  const draftHere = stampP === page;

  const point = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };
  const onDown = (e) => {
    if (!tool) return;
    if (!draftHere && (shapes.length || pin)) { go(stampP); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    if (tool === 'pin') return setPin(p);
    setDraft({ type: tool, c: color, pts: [p], a: p, b: p });
  };
  const onMove = (e) => {
    if (!draft) return;
    const p = point(e);
    setDraft((d) => (d.type === 'pen' ? { ...d, pts: [...d.pts, p] } : { ...d, b: p }));
  };
  const onUp = () => {
    if (!draft) return;
    const d = draft;
    setDraft(null);
    const ok = d.type === 'pen' ? d.pts.length > 2 : Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) > 0.01;
    if (ok) setShapes((s) => [...s, toShape(d)]);
  };
  const resetDraft = () => { setBody(''); setTool(null); setToolsOpen(false); setPin(null); setShapes([]); setDraft(null); };

  // le commentaire d'un client déclenche une notification push chez l'hôte
  const post = async (payload) => {
    const cid = await data.addComment(aid, currentN, { author: name, ...payload });
    if (!admin) notifyHost({ aid, n: currentN, cid, kind: 'comment' });
    return cid;
  };
  const remember = () => { try { localStorage.setItem('review-name', name); } catch {} setNameOk(true); setEditName(false); };
  const send = async () => {
    if (!body.trim() || !name.trim()) return;
    remember();
    try { await post({ body, t: stampP, t_end: null, x: pin?.[0], y: pin?.[1], shapes }); } catch { alert('Le commentaire n’a pas pu être envoyé (accès refusé ou review désactivée).'); return; }
    resetDraft();
  };
  const sendReply = async () => {
    if (!replyText.trim() || !name.trim()) return;
    remember();
    try { await post({ body: replyText, t: 0, parent_id: replyTo }); } catch { alert('La réponse n’a pas pu être envoyée.'); return; }
    setReplyText(''); setReplyTo(null);
  };
  const setReview = async (st) => {
    if (st && !name.trim()) { setEditName(true); setNeedName(true); return; }
    try { await data.setApproval(aid, currentN, st, name.trim()); } catch { return; }
    if (st && !admin) notifyHost({ aid, n: currentN, kind: 'status' });
    if (st) remember();
    setNeedName(false);
    setApproval(st ? { status: st, by: name.trim(), at: Date.now() } : null);
  };
  const goVersion = (n) => navigate(`/r/${aid}?v=${n}`);
  const fmtDay = (t) => new Date(t).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
  const fmtWhen = (t) => new Date(t).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const copyLink = (c) => { try { navigator.clipboard.writeText(`${location.origin}${location.pathname}?c=${c.id}`); } catch {} };
  const del = (c) => { if (confirm('Supprimer ce commentaire ?')) data.deleteComment(aid, currentN, c.id).catch(() => {}); };

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go((p) => p - 1); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go((p) => p + 1); }
      else if (e.key === 'Escape') setTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // --- données dérivées ---
  const tops = useMemo(() => comments.filter((c) => !c.parent_id).sort((a, b) => a.t - b.t || a.created_at - b.created_at), [comments]);
  const kids = useCallback((id) => comments.filter((c) => c.parent_id === id), [comments]);
  const numberOf = useMemo(() => Object.fromEntries(tops.map((c, i) => [c.id, i + 1])), [tops]);
  const authors = useMemo(() => [...new Set(comments.map((c) => c.author))], [comments]);
  const perPage = useMemo(() => { const m = {}; tops.forEach((c) => { const p = Math.round(c.t); m[p] = (m[p] || 0) + (c.resolved ? 0 : 1); }); return m; }, [tops]);
  const shown = tops.filter((c) => {
    if (status === 'open' && c.resolved) return false;
    if (status === 'done' && !c.resolved) return false;
    const thread = [c, ...kids(c.id)];
    if (author && !thread.some((x) => x.author === author)) return false;
    if (q && !thread.some((x) => x.body.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });
  const visible = tops.filter((c) => hasMarks(c) && Math.round(c.t) === page);
  const pageLabel = (p) => (count > 1 ? `Page ${Math.round(p) + 1}` : '');
  const askName = !nameOk || editName;
  const kindLabel = KIND_LABEL[version.kind] || 'Fichier';

  return (
    <div className="review">
      <div className="stage">
        <header className="topbar">
          <div>
            <div className="review-context">{back
              ? <Link className="eyebrow back" to={back.to}>← {back.label}</Link>
              : <div className="eyebrow">Review · {kindLabel}</div>}{deadline}</div>
            <h1 className="title">{title}</h1>
            {admin && (
              <div className="status-line">
                {approval
                  ? <><span className={`state ${approval.status}`}>{approval.status === 'approved' ? 'Validée par le client' : 'Le client demande des modifications'}</span> · {approval.by}, {fmtDay(approval.at)}</>
                  : 'En attente de l’avis du client'}
              </div>
            )}
          </div>
          <div className="row">
            {versions.length > 1 && (
              <div className="seg-ctl" role="group" aria-label="Version">
                {versions.map((x) => (
                  <button key={x.n} className={x.n === currentN ? 'on' : ''} onClick={() => x.n !== currentN && goVersion(x.n)}>
                    v{x.n}{x.status === 'approved' ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            )}
            <div className="seg-ctl" role="group" aria-label="Mode d’affichage">
              <button className={pro ? '' : 'on'} onClick={() => pro && togglePro()}>Simple</button>
              <button className={pro ? 'on' : ''} onClick={() => !pro && togglePro()} title="Recherche, filtre par auteur, liens vers les commentaires">Pro</button>
            </div>
          </div>
        </header>

        {currentN !== latestN && (
          <div className="banner">
            <span>Tu regardes la v{currentN}. La version la plus récente est la v{latestN}.</span>
            <button className="ghost sm" onClick={() => goVersion(latestN)}>Voir la v{latestN}</button>
          </div>
        )}
        {!admin && (() => { const mine = approval && name.trim() && approval.by === name.trim(); return (
          <div className="approval">
            <div>
              {approval
                ? <><span className={`state ${approval.status}`}>{mine
                    ? (approval.status === 'approved' ? 'Tu as validé cette version' : 'Tu as demandé des modifications')
                    : `${approval.by} ${approval.status === 'approved' ? 'a validé cette version' : 'a demandé des modifications'}`}</span><span className="mut"> · {fmtDay(approval.at)}</span></>
                : <span><strong>Ton avis sur la v{currentN}</strong><span className="mut"> · Il s’applique à cette version.</span></span>}
            </div>
            <div className="row">
              {approval && <button className="link" onClick={() => setReview(null)}>{mine ? 'Changer d’avis' : 'Retirer l’avis'}</button>}
              <button className={approval?.status === 'changes' ? 'ghost sm on' : 'ghost sm'} onClick={() => setReview('changes')}>Demander des changements</button>
              <button className={approval?.status === 'approved' ? 'ok sm' : 'sm'} onClick={() => setReview('approved')}>{approval?.status === 'approved' ? '✓ Approuvée' : 'Approuver'}</button>
            </div>
          </div>
        ); })()}

        <div className={`pstage ${zoom > 1 ? 'zoomed' : ''}`} ref={stage}>
          {loadErr ? (
            <div className="vmsg static"><p><strong>Le fichier ne s’affiche pas.</strong></p><p className="mut">{loadErr}</p></div>
          ) : !pg ? (
            <div className="vbuf static">{doc ? `Page ${page + 1}…` : 'Ouverture du fichier…'}</div>
          ) : (
            <div className="pwrap" style={{ width: box.w, height: box.h }}>
              <PageContent pg={pg} scale={scale} />
              <div className="ov" style={{ inset: 0, pointerEvents: tool ? 'auto' : 'none', cursor: tool ? 'crosshair' : 'default' }}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
                <svg viewBox="0 0 1 1" preserveAspectRatio="none">
                  {visible.flatMap((c) => (c.shapes || []).map((s, i) => <Shape key={`${c.id}-${i}`} s={s} box={box} />))}
                  {draftHere && shapes.map((s, i) => <Shape key={`d${i}`} s={s} box={box} />)}
                  {draft && <Shape s={toShape(draft)} box={box} />}
                </svg>
                {visible.filter((c) => c.x != null).map((c) => (
                  <div key={c.id} className={`pin ${sel === c.id ? 'sel' : ''}`} style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}><b>{numberOf[c.id]}</b></div>
                ))}
                {pin && draftHere && <div className="pin draft" style={{ left: `${pin[0] * 100}%`, top: `${pin[1] * 100}%` }}><b>+</b></div>}
              </div>
            </div>
          )}
        </div>

        <div className="still-drawing-anchor">{toolsOpen && <div className="still-draw-popover"><DrawingToolbar tool={tool} onTool={(next) => setTool((prev) => prev === next ? null : next)} color={color} onColor={setColor} canUndo={!!shapes.length || !!pin} onUndo={() => shapes.length ? setShapes((items) => items.slice(0, -1)) : setPin(null)} /></div>}</div>

        <div className="transport">
          {count > 1 && (
            <>
              <button className="ghost icon" title="Page précédente (←)" aria-label="Page précédente" disabled={page === 0} onClick={() => go(page - 1)}><IconChevron dir="left" /></button>
              <div className="timecode"><span className="cur">Page {page + 1}</span><span className="tot">/ {count}</span></div>
              <button className="ghost icon" title="Page suivante (→)" aria-label="Page suivante" disabled={page >= count - 1} onClick={() => go(page + 1)}><IconChevron dir="right" /></button>
            </>
          )}
          <div className="spacer" />
          <div className="seg-ctl sm" role="group" aria-label="Zoom">
            <button onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])} disabled={zoom === 1} aria-label="Dézoomer">−</button>
            <button onClick={() => setZoom(1)} className={zoom === 1 ? 'on' : ''}>Ajuster</button>
            <button onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])} disabled={zoom === ZOOMS[ZOOMS.length - 1]} aria-label="Zoomer">+</button>
          </div>
          <button className={toolsOpen ? 'ghost on' : 'ghost'} onClick={() => setToolsOpen((o) => { if (o) setTool(null); return !o; })}>Dessiner</button>
        </div>

        {count > 1 && count <= 60 && (
          <div className="pages">
            {Array.from({ length: count }, (_, i) => (
              <button key={i} className={i === page ? 'on' : ''} onClick={() => go(i)} title={perPage[i] ? `${perPage[i]} à traiter` : ''}>
                {i + 1}{perPage[i] ? <i /> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      <aside className="side">
        <div className="side-head">
          <h2>Commentaires</h2>
          <CommentNavigation comments={shown} currentId={sel} position={page} onSelect={(c) => { setSel(c.id); go(Math.round(c.t)); }} />
        </div>
        <div className="filters">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="seg-ctl sm">
              {[['all', 'Tous'], ['open', 'À traiter'], ['done', 'Résolus']].map(([k, l]) => (
                <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
              ))}
            </div>
          </div>
          {pro && (
            <div className="row">
              <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
              <select value={author} onChange={(e) => setAuthor(e.target.value)}>
                <option value="">Tous</option>
                {authors.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="list">
          {shown.map((c) => (
            <div key={c.id} data-comment-id={c.id} className={`cm ${c.resolved ? 'done' : ''} ${sel === c.id ? 'sel' : ''}`}
              onClick={() => { setSel(c.id); go(Math.round(c.t)); }}>
              <div className="cm-head">
                <span>
                  <span className="num">{numberOf[c.id]}</span>{count > 1 && <><span className="tc">{pageLabel(c.t)}</span> · </>}<strong>{c.author}</strong>
                  <span className="when" title={new Date(c.created_at).toLocaleString('fr-BE')}>{fmtWhen(c.created_at)}</span>
                  {hasMarks(c) && <span className="tag">dessin</span>}
                </span>
                <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {pro && <button className="ghost sm" title="Copier le lien vers ce commentaire" onClick={() => copyLink(c)}>Lien</button>}
                  <button className="ghost sm" onClick={() => data.setResolved(aid, currentN, c.id, !c.resolved).catch(() => {})}>{c.resolved ? 'Rouvrir' : '✓ Résolu'}</button>
                  {admin && <button className="ghost sm" aria-label="Supprimer" onClick={() => del(c)}>✕</button>}
                </span>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
              {kids(c.id).map((r) => (
                <div key={r.id} className="reply">
                  <strong>{r.author}</strong> <span className="when">{fmtWhen(r.created_at)}</span>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
                </div>
              ))}
              <div onClick={(e) => e.stopPropagation()}>
                {replyTo === c.id ? (
                  <div className="row" style={{ marginTop: 10 }}>
                    <input autoFocus placeholder="Répondre…" value={replyText} onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') sendReply(); if (e.key === 'Escape') setReplyTo(null); }} />
                    <button className="sm" onClick={sendReply} disabled={!replyText.trim() || !name.trim()}>OK</button>
                  </div>
                ) : (
                  <button className="link" onClick={() => { setReplyTo(c.id); setReplyText(''); }}>Répondre</button>
                )}
              </div>
            </div>
          ))}
          {!shown.length && <p className="mut">{tops.length ? 'Aucun résultat.' : 'Aucun commentaire.'}</p>}
        </div>

        <div className="compose">
          {askName
            ? <div style={{ display: 'grid', gap: 6 }}>
                {needName && <span className="mut">Indique ton prénom pour valider cette version, puis clique à nouveau.</span>}
                <input placeholder="Ton prénom" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            : <div className="compose-who mut">Tu commentes en tant que&nbsp;<strong style={{ color: 'var(--txt)' }}>{name}</strong>&nbsp;·&nbsp;<button className="link" style={{ padding: 0 }} onClick={() => setEditName(true)}>changer</button></div>}
          <textarea rows={3} placeholder={count > 1 ? `Ton commentaire sur la page ${stampP + 1}…` : 'Ton commentaire…'} value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="mut">{drawing ? `${shapes.length + (pin ? 1 : 0)} dessin(s) joint(s)` : '⌘ + Entrée pour envoyer'}</span>
            <button onClick={send} disabled={!body.trim() || !name.trim()}>Envoyer</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
