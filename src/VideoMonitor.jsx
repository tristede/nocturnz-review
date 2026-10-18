import { useEffect, useRef, useState } from 'react';
import { IconChevron, IconPause, IconPlay, clamp } from './draw';
import { readSession, writeSession } from './reviewSession';

const PRESETS = [25, 50, 75, 100, 150, 200, 400];
function MonitorIcon({ kind }) {
  const paths = {
    zoom: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5M7 10h6m-3-3v6" /></>,
    hand: <path d="M7 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v8c0 4-2 6-6 6-3 0-4-2-6-5l-3-4a1.5 1.5 0 0 1 2-2l2 2" />,
    safe: <><rect x="3" y="4" width="18" height="16" /><rect x="7" y="7" width="10" height="10" strokeDasharray="2 2" /></>,
    ruler: <><path d="M3 3h18v5H8v13H3zM7 3v3m4-3v2m4-2v3m4-3v2M3 11h3m-3 4h2m-2 4h3" /></>,
    guides: <><path d="M3 8h18M8 3v18" strokeDasharray="3 2" /><path d="M15 13v8m-4-4h8" /></>,
    pen: <><path d="m4 16 12-12 4 4L8 20H4zM13 7l4 4" /></>,
    camera: <><path d="M3 7h4l2-3h6l2 3h4v14H3z" /><circle cx="12" cy="13" r="4" /></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

function ticks(length, origin, pixelsPerUnit) {
  if (!pixelsPerUnit) return [];
  const raw = 60 / pixelsPerUnit, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((x) => x * power >= raw) * power;
  const out = [];
  for (let unit = Math.max(0, Math.ceil(-origin / (step * pixelsPerUnit)) * step); out.length < 150; unit += step) {
    const at = origin + unit * pixelsPerUnit;
    if (at > length) break;
    out.push({ at, unit: Math.round(unit * 100) / 100 });
  }
  return out;
}

// La vidéo, les dessins et les repères partagent le même plan : le zoom conserve leur alignement.
export default function VideoMonitor({ aid, viewportRef, fit, nativeSize, box, children, playing, onPlay, onStep, toolsOpen, onTools, drawingTools, onToolbarHeight, sessionKey, sourceIdentity, ready, onCapture, captureDisabled, capturing }) {
  const viewport = useRef(null), drag = useRef(null);
  const toolbar = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [remembered] = useState(() => readSession(`${sessionKey}:monitor`, sourceIdentity));
  const [zoom, setZoom] = useState(() => Number.isFinite(remembered?.zoom) && remembered.zoom > 0 && remembered.zoom <= 6400 ? remembered.zoom : 'fit');
  const [pan, setPan] = useState(() => Number.isFinite(remembered?.pan?.x) && Number.isFinite(remembered?.pan?.y) ? remembered.pan : { x: 0, y: 0 });
  const [viewTool, setViewTool] = useState(null);
  const [safe, setSafe] = useState(remembered?.safe === true);
  const [rulers, setRulers] = useState(remembered?.rulers === true);
  const [guides, setGuides] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`review-guides-${aid}`) || '[]');
      return Array.isArray(saved) ? saved.filter((g) => ['x', 'y'].includes(g.axis) && Number.isFinite(g.at) && g.at >= 0 && g.at <= 1).slice(0, 100) : [];
    } catch { return []; }
  });
  const image = box.w && box.h ? box : { x: 0, y: 0, w: size.w, h: size.h };
  const natural = nativeSize?.w > 0 ? nativeSize : null;
  const basis = natural && image.w ? natural.w / image.w : 1;
  const scale = zoom === 'fit' ? 1 : clamp(Number(zoom) / 100 * basis, .05, 64);
  const limitPan = (p, z = scale) => ({ x: clamp(p.x, -Math.max(0, (z - 1) * size.w / 2), Math.max(0, (z - 1) * size.w / 2)), y: clamp(p.y, -Math.max(0, (z - 1) * size.h / 2), Math.max(0, (z - 1) * size.h / 2)) });
  const origin = { x: size.w / 2 + pan.x - size.w * scale / 2 + image.x * scale, y: size.h / 2 + pan.y - size.h * scale / 2 + image.y * scale };
  const unitW = natural?.w || 100, unitH = natural?.h || 100;
  const reset = () => { setZoom('fit'); setPan({ x: 0, y: 0 }); };
  const changeScale = (next, anchor = { x: 0, y: 0 }) => {
    next = clamp(next, .05, 64);
    setZoom(Math.round(next / basis * 1000) / 10);
    setPan(limitPan({ x: anchor.x - (anchor.x - pan.x) * next / scale, y: anchor.y - (anchor.y - pan.y) * next / scale }, next));
  };
  useEffect(() => {
    const ro = new ResizeObserver(() => setSize({ w: viewport.current.clientWidth, h: viewport.current.clientHeight }));
    ro.observe(viewport.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const ro = new ResizeObserver(() => onToolbarHeight?.(toolbar.current.getBoundingClientRect().height));
    ro.observe(toolbar.current);
    return () => ro.disconnect();
  }, [onToolbarHeight]);
  useEffect(() => { if (ready && size.w > 0) setPan((p) => limitPan(p)); }, [size.w, size.h, scale, ready]);
  useEffect(() => { if (ready && size.w > 0) writeSession(`${sessionKey}:monitor`, { source: sourceIdentity, zoom, pan, safe, rulers }); }, [ready, size.w, sessionKey, sourceIdentity, zoom, pan, safe, rulers]);
  useEffect(() => { if (toolsOpen) setViewTool(null); }, [toolsOpen]);
  useEffect(() => { try { localStorage.setItem(`review-guides-${aid}`, JSON.stringify(guides)); } catch {} }, [aid, guides]);
  useEffect(() => {
    const el = viewport.current;
    const wheel = (e) => {
      if (!e.ctrlKey && !e.metaKey && viewTool !== 'zoom') return;
      e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect();
      changeScale(scale * Math.exp(-e.deltaY * .005), { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [scale, pan, size, viewTool, basis]);
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') setViewTool(null);
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '0') { e.preventDefault(); reset(); }
      else if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); changeScale(scale * (e.key === '-' ? 1 / 1.5 : 1.5)); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [scale, pan, size, basis]);

  const guideAt = (e, axis) => {
    const r = viewport.current.getBoundingClientRect();
    return clamp((axis === 'x' ? e.clientX - r.left - origin.x : e.clientY - r.top - origin.y) / ((axis === 'x' ? image.w : image.h) * scale));
  };
  const startGuide = (e, axis, id = crypto.randomUUID()) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    setViewTool(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind: 'guide', axis, id, before: guides };
    if (!guides.some((g) => g.id === id)) setGuides((gs) => [...gs, { id, axis, at: guideAt(e, axis) }]);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') setPan(limitPan({ x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y }));
    else setGuides((gs) => gs.map((g) => g.id === d.id ? { ...g, at: guideAt(e, d.axis) } : g));
  };
  const end = (e) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.kind === 'guide') {
      if (e.type === 'pointercancel') { setGuides(d.before); return; }
      const r = viewport.current.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setGuides((gs) => gs.filter((g) => g.id !== d.id));
    }
  };
  const toggleTool = (next) => { if (viewTool !== next && toolsOpen) onTools(); setViewTool((prev) => prev === next ? null : next); };
  const presets = typeof zoom === 'number' && !PRESETS.includes(zoom) ? [...PRESETS, zoom].sort((a, b) => a - b) : PRESETS;
  const addGuide = (axis) => { setViewTool(null); setRulers(true); setGuides((gs) => [...gs, { id: crypto.randomUUID(), axis, at: .5 }]); };
  return <div className="monitor-shell" style={{ width: fit?.w, '--monitor-tools-width': fit?.availableW ? `${fit.availableW}px` : '100%' }}>
    <div className="vwrap monitor-viewport" ref={(el) => { viewport.current = el; viewportRef.current = el; }} style={fit ? { height: fit.h } : undefined}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className="monitor-plane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
        {children}
        {safe && <div className="monitor-safe" style={{ left: image.x, top: image.y, width: image.w, height: image.h }}><i className="safe-action" /><i className="safe-title" /><b /></div>}
        {rulers && guides.map((g) => <div key={g.id} className={`monitor-guide ${g.axis}`} style={g.axis === 'x' ? { left: image.x + g.at * image.w, top: image.y, height: image.h, width: 9 / scale, marginLeft: -4 / scale } : { top: image.y + g.at * image.h, left: image.x, width: image.w, height: 9 / scale, marginTop: -4 / scale }} onPointerDown={(e) => startGuide(e, g.axis, g.id)}><i style={{ [g.axis === 'x' ? 'width' : 'height']: 1 / scale }} /></div>)}
      </div>
      {viewTool && <div className={`monitor-interaction ${viewTool}`} onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        if (viewTool === 'zoom') { const r = viewport.current.getBoundingClientRect(); changeScale(scale * (e.altKey ? 1 / 1.5 : 1.5), { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 }); }
        else { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, pan }; }
      }} />}
      {rulers && <>
        <div className="monitor-ruler horizontal" title="Glisser pour créer un guide horizontal" onPointerDown={(e) => startGuide(e, 'y')}>
          {ticks(size.w, origin.x, image.w * scale / unitW).filter((t) => t.unit <= unitW).map((t) => <span key={t.unit} style={{ left: t.at }}>{t.unit}{natural ? '' : '%'}</span>)}
        </div>
        <div className="monitor-ruler vertical" title="Glisser pour créer un guide vertical" onPointerDown={(e) => startGuide(e, 'x')}>
          {ticks(size.h, origin.y, image.h * scale / unitH).filter((t) => t.unit <= unitH).map((t) => <span key={t.unit} style={{ top: t.at - 18 }}>{t.unit}{natural ? '' : '%'}</span>)}
        </div>
      </>}
    </div>
    <div className="monitor-toolbar" ref={toolbar} role="toolbar" aria-label="Outils du moniteur vidéo">
      <select aria-label="Échelle de la vidéo" value={zoom} onChange={(e) => { setZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value)); setPan({ x: 0, y: 0 }); }} title={natural ? '100 % = un pixel de la source par pixel à l’écran' : 'YouTube : échelle relative au cadre, résolution source indisponible'}>
        <option value="fit">Adapter</option>{presets.map((p) => <option key={p} value={p}>{p} %{natural ? '' : ' du cadre'}</option>)}
      </select>
      <button className={`ghost icon ${viewTool === 'zoom' ? 'on' : ''}`} aria-label="Loupe" aria-pressed={viewTool === 'zoom'} title="Loupe · Alt + clic pour dézoomer" onClick={() => toggleTool('zoom')}><MonitorIcon kind="zoom" /></button>
      <button className={`ghost icon ${viewTool === 'pan' ? 'on' : ''}`} aria-label="Déplacer l’image" aria-pressed={viewTool === 'pan'} title="Déplacer l’image agrandie" onClick={() => toggleTool('pan')}><MonitorIcon kind="hand" /></button>
      <span className="monitor-separator" />
      <button className="ghost icon" onClick={() => onStep(-1)} title="Image précédente" aria-label="Image précédente"><IconChevron dir="left" /></button>
      <button className="ghost icon" onClick={onPlay} aria-label={playing ? 'Pause' : 'Lecture'}>{playing ? <IconPause /> : <IconPlay />}</button>
      <button className="ghost icon" onClick={() => onStep(1)} title="Image suivante" aria-label="Image suivante"><IconChevron dir="right" /></button>
      <span className="monitor-separator" />
      <button className={`ghost icon ${safe ? 'on' : ''}`} aria-label="Zones sûres" aria-pressed={safe} title="Zones sûres · action 90 %, titres 80 %" onClick={() => setSafe(!safe)}><MonitorIcon kind="safe" /></button>
      <button className={`ghost icon ${rulers ? 'on' : ''}`} aria-label="Règles et guides" aria-pressed={rulers} title="Règles · glisser depuis une règle pour ajouter un guide" onClick={() => setRulers(!rulers)}><MonitorIcon kind="ruler" /></button>
      <details className="monitor-guide-menu">
        <summary title="Gérer les guides" aria-label="Gérer les guides"><MonitorIcon kind="guides" /></summary>
        <div className="monitor-guide-panel">
          <div className="row"><button className="ghost sm" onClick={() => addGuide('y')}>+ Horizontal</button><button className="ghost sm" onClick={() => addGuide('x')}>+ Vertical</button></div>
          {guides.map((g) => <label key={g.id} className="monitor-guide-field"><span>{g.axis === 'x' ? 'Vertical' : 'Horizontal'}</span><input aria-label={`Position du guide ${g.axis === 'x' ? 'vertical' : 'horizontal'}`} type="number" min="0" max={g.axis === 'x' ? unitW : unitH} step="1" value={Math.round(g.at * (g.axis === 'x' ? unitW : unitH))} onChange={(e) => { const at = clamp(Number(e.target.value) / (g.axis === 'x' ? unitW : unitH)); setGuides((gs) => gs.map((item) => item.id === g.id ? { ...item, at } : item)); }} /><span>{natural ? 'px' : '%'}</span><button className="ghost sm" aria-label="Supprimer ce guide" onClick={() => setGuides((gs) => gs.filter((item) => item.id !== g.id))}>×</button></label>)}
          {!!guides.length && <button className="link" onClick={() => setGuides([])}>Effacer les guides</button>}
        </div>
      </details>
      <button className={`ghost icon ${toolsOpen ? 'on' : ''}`} aria-label="Dessiner" aria-pressed={toolsOpen} title="Annoter l’image" onClick={() => { setViewTool(null); onTools(); }}><MonitorIcon kind="pen" /></button>
      <button className="ghost icon" aria-label="Capturer l’image annotée" disabled={captureDisabled || capturing} title={captureDisabled ? 'YouTube ne permet pas la capture de ses images' : capturing ? 'Capture en cours…' : 'Télécharger l’image avec ses annotations'} onClick={onCapture}><MonitorIcon kind="camera" /></button>
    </div>
    {toolsOpen && <div className="monitor-draw-popover">{drawingTools}</div>}
  </div>;
}
