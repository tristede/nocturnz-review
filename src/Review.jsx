import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import VideoMonitor from './VideoMonitor';
import CommentNavigation from './CommentNavigation';
import { readSession, writeSession } from './reviewSession';
import { captureAnnotatedFrame } from './captureFrame';
import DrawingToolbar from './DrawingToolbar';
import * as data from './data';
import { notifyHost } from './push';
import { videoUrl, driveMeta, cleanDownloadUrl } from './links';
import { peaksFromLocalMp4, peaksFromBuffer, encodePeaks, b64ToBytes } from './audioPeaks';
import Brand, { BackButton } from './Brand';
import { COLORS, clamp, parse, hasMarks, Shape, toShape, IconPlay, IconPause } from './draw';

const PRESETS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
const pad = (n) => String(n).padStart(2, '0');

// framerate détecté à partir des temps de présentation des images (requestVideoFrameCallback)
async function detectFps(v) {
  if (!('requestVideoFrameCallback' in v)) return null;
  const back = v.currentTime, muted = v.muted;
  const diffs = [];
  let last = null;
  v.muted = true;
  await new Promise((done) => {
    const cb = (_, m) => {
      if (last != null && m.mediaTime > last) diffs.push(m.mediaTime - last);
      last = m.mediaTime;
      if (diffs.length >= 40) done();
      else v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
    v.play().catch(done);
    setTimeout(done, 4000);
  });
  v.pause();
  v.currentTime = back;
  v.muted = muted;
  if (diffs.length < 8) return null;
  diffs.sort((a, b) => a - b);
  const raw = 1 / diffs[Math.floor(diffs.length / 2)];
  const near = PRESETS.reduce((b, p) => (Math.abs(p - raw) < Math.abs(b - raw) ? p : b));
  return Math.abs(near - raw) / near < 0.02 ? near : Math.round(raw * 1000) / 1000;
}

const decodePeaks = (str) => {
  if (!str) return null;
  if (str.startsWith('2:')) {
    const all = b64ToBytes(str.slice(2)), half = all.length / 2;
    return { l: all.slice(0, half), r: all.slice(half) };
  }
  return { l: b64ToBytes(str), r: null };
};

// décode l'audio de la vidéo : ~200 pics/seconde (0..255) par canal, ou null s'il n'y a pas de son exploitable
async function computePeaks(url, dur) {
  const res = await fetch(url);
  if (!res.ok || Number(res.headers.get('content-length') || 0) > 400e6) return null;
  return peaksFromBuffer(await res.arrayBuffer(), dur);
}

// teinte selon l'intensité : bleu profond (faible) → violet → mauve clair (fort)
const tintOf = (v) => `hsl(${Math.round(228 + 60 * v)} ${Math.round(70 + 8 * v)}% ${Math.round(46 + 32 * v)}%)`;
const FLAT = 'rgba(150,132,255,.85)';
const WAVE_STYLES = [['bars', 'Barres'], ['solid', 'Plein'], ['line', 'Ligne']];

// onde sonore : suit exactement la vue (zoom/défilement) de la timeline ; les deux canaux sont fusionnés
// low = onde posée en bas de la piste au lieu d'être centrée
function Wave({ peaks, dur, vs, span, variant, tint, low, muted, fine = false }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const merged = useMemo(() => (peaks.r ? peaks.l.map((v, i) => Math.max(v, peaks.r[i])) : peaks.l), [peaks]);
  useEffect(() => {
    const ro = new ResizeObserver(() => setSize({ w: ref.current.clientWidth, h: ref.current.clientHeight }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const cv = ref.current, { w, h } = size;
    if (!w || !h || !dur) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const color = (v) => (muted ? 'rgba(150, 148, 175, .5)' : tint === 'vol' ? tintOf(v) : FLAT); // muted = onde « vide » grisée

    // dessine une voie (tableau de pics) dans la bande verticale [y0, y0 + hl]
    const lane = (arr, y0, hl) => {
      const n = arr.length;
      const col = (x0, x1) => {
        const t0 = vs + (x0 / w) * span, t1 = vs + (x1 / w) * span;
        if (t1 < 0 || t0 > dur) return null;
        const i0 = Math.min(n - 1, Math.max(0, Math.floor((t0 / dur) * n)));
        const i1 = Math.min(n, Math.max(i0 + 1, Math.ceil((t1 / dur) * n)));
        let m = 0;
        for (let i = i0; i < i1; i++) if (arr[i] > m) m = arr[i];
        return m / 255;
      };
      const axis = y0 + hl / 2;
      const base = low ? y0 + hl - 1 : axis;
      // En bas : les crêtes atteignent l'axe central. Centrée : même amplitude de chaque côté.
      const maxHeight = low ? hl / 2 - 1 : hl * 0.64;
      const yOf = (hh) => (low ? base - hh : axis - hh / 2);
      if (variant === 'bars') {
        const bs = fine ? 2 : 4, bw = fine ? 1.4 : 3; // fine : une barre tous les 2 px
        for (let x = 0; x < w; x += bs) {
          const v = col(x, x + bs);
          if (v == null) continue;
          const hh = Math.max(1, v * maxHeight);
          g.fillStyle = color(v);
          g.fillRect(x, yOf(hh), bw, hh);
        }
      } else if (variant === 'solid') {
        for (let x = 0; x < w; x++) {
          const v = col(x, x + 1);
          if (v == null) continue;
          const hh = Math.max(1, v * maxHeight);
          g.fillStyle = color(v);
          g.fillRect(x, yOf(hh), 1, hh);
        }
      } else { // un seul trait ; les pics non signés alternent autour de l'axe en mode centré
        g.lineWidth = 1.6; g.lineCap = 'round'; g.lineJoin = 'round';
        const step = 3, room = low ? maxHeight : maxHeight / 2;
        let px = null, py = null;
        for (let x = 0; x < w; x += step) {
          const v = col(x, x + step);
          if (v == null) { px = null; continue; }
          const polarity = Math.round(x / step) % 2 ? -1 : 1;
          const y = base + (low ? -1 : polarity) * v * room;
          if (px != null) {
            g.strokeStyle = color(v);
            g.beginPath(); g.moveTo(px, py); g.bezierCurveTo(px + step / 2, py, x - step / 2, y, x, y); g.stroke();
          }
          px = x; py = y;
        }
      }
    };

    g.fillStyle = 'rgba(203,179,236,.12)';
    g.fillRect(0, Math.floor(h / 2), w, 1);
    lane(merged, 0, h);
  }, [peaks, merged, dur, vs, span, size, variant, tint, low, muted, fine]);
  return <canvas ref={ref} className="wave" style={{ top: 0, height: '100%' }} />;
}

// mise en page mobile : bascule sur la largeur de l'écran
function useMedia(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q), f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

const MIcon = ({ d }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const M_ICONS = {
  pen: <path d="m4 16 12-12 4 4L8 20H4zM13 7l4 4" />,
  marker: <path d="M6 4h12v10l-6 6-6-6z" />,
  download: <path d="M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 19.5h14" />,
  camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="3.6" /></>,
  back: <path d="M15 5 8 12l7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
  chat: <><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12z" /><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" strokeWidth="2.4" /></>,
  sound: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></>,
  mute: <><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="m16 9.5 5 5m0-5-5 5" /></>,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  play: <path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11-7.2c.6-.4.6-1.4 0-1.8l-11-7.2C7.9 3.5 7 4 7 4.8z" />,
  pause: <path d="M8 5v14M16 5v14" />,
};

// libellé d'une graduation : « 2s », « 2,4s » sous la seconde, « 1:05 » au-delà d'une minute
// repère façon Premiere : écusson numéroté + trait sur toute la hauteur ; une plage = bande colorée
function Marker({ c, n, left, width = null, sel, onDown, title }) {
  return (
    <div className={`pm ${c.resolved ? 'done' : ''} ${sel ? 'sel' : ''} ${width ? 'range' : ''}`} style={width ? { left, width } : { left }}
      title={title} onPointerDown={onDown}>
      {width && <i />}<b>{n}</b>
    </div>
  );
}

const rulerLabel = (t, step) => {
  if (t >= 60 && step >= 1) return `${Math.floor(t / 60)}:${pad(Math.round(t % 60))}`;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return `${t.toFixed(digits).replace('.', ',')}s`;
};

// Timeline mobile façon CapCut : la tête reste au centre, la timeline défile sous le doigt.
// Glisser lentement = image par image ; deux doigts ou double toucher = zoom.
function MobileTrack({ dur, now, F, clock, numberOf, sel, peaks, flatPeaks, waveStyle, waveTint, waveLow, tops, onScrub, onScrubEnd, onPick, onAdd, pending }) {
  const el = useRef(null);
  const [w, setW] = useState(360);
  const [pps, setPps] = useState(64);              // pixels par seconde
  const g = useRef({ pts: new Map(), start: null, pinch: null, lastTap: 0 });
  useEffect(() => {
    const ro = new ResizeObserver(() => setW(el.current?.clientWidth || 360));
    ro.observe(el.current);
    // iPhone : sans ça, Safari peut reprendre le geste (défilement, retour arrière) et couper le glissement
    const stop = (e) => e.preventDefault();
    el.current.addEventListener('touchstart', stop, { passive: false });
    el.current.addEventListener('touchmove', stop, { passive: false });
    const node = el.current;
    return () => { ro.disconnect(); node.removeEventListener('touchstart', stop); node.removeEventListener('touchmove', stop); };
  }, []);
  // la tête marque le début de l'image affichée (le lecteur vise le milieu de l'image pour éviter les arrondis)
  const span = w / pps, vs = Math.floor(now * F + 1e-4) / F - span / 2;
  const xp = (t) => `${((t - vs) / span) * 100}%`;
  const maxF = Math.max(0, Math.ceil(dur * F) - 1);
  // dézoom maximal : toute la vidéo visible d'un côté de la tête ; zoom maximal : ~16 px par image à 25 i/s
  // (la tête étant au centre, la vidéo entière doit tenir dans une demi-largeur pour être vue d'un coup)
  const minPps = (w * 0.46) / Math.max(dur, 0.1), maxPps = 400;

  const down = (e) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const st = g.current;
    // premier doigt d'un nouveau geste : on oublie les doigts dont Safari n'a pas signalé la fin
    // (sinon un seul doigt est pris pour un pincement et la timeline zoome au lieu de défiler)
    if (e.isPrimary) { st.pts.clear(); st.pinch = null; }
    st.pts.set(e.pointerId, e.clientX);
    if (st.pts.size === 2) { // pincement : zoom de la timeline
      const [a, b] = [...st.pts.values()];
      st.pinch = { d: Math.abs(a - b) || 1, pps };
      return;
    }
    st.start = { x: e.clientX, t: now, moved: false };
  };
  const move = (e) => {
    const st = g.current;
    if (!st.pts.has(e.pointerId)) return;
    st.pts.set(e.pointerId, e.clientX);
    if (st.pinch && st.pts.size >= 2) {
      const [a, b] = [...st.pts.values()];
      setPps(clamp(st.pinch.pps * (Math.abs(a - b) / st.pinch.d), minPps, maxPps));
      return;
    }
    if (!st.start) return;
    const dx = e.clientX - st.start.x;
    if (Math.abs(dx) > 6) st.start.moved = true;
    if (!st.start.moved) return;
    onScrub(clamp(Math.floor((st.start.t - dx / pps) * F + 1e-4), 0, maxF));
  };
  const up = (e) => {
    const st = g.current;
    st.pts.delete(e.pointerId);
    if (st.pts.size >= 1) return;
    if (st.start?.moved) onScrubEnd();
    else if (st.start && !st.pinch) {
      // double toucher : tout voir ⇄ zoom de travail
      const t = performance.now();
      if (t - st.lastTap < 320) { setPps((p) => (p > minPps * 1.5 ? minPps : 64)); st.lastTap = 0; } else st.lastTap = t;
    }
    st.start = null; st.pinch = null;
  };

  // graduations : libellées tous les ~64 px au moins ; traits secondaires entre deux (jusqu'à l'image près)
  const fr = 1 / F;
  const steps = [fr, 2 * fr, 5 * fr, 10 * fr, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((x) => x * pps >= 64) || 3600;
  const minor = [step / 10, step / 5, step / 4, step / 2].map((x) => Math.max(x, fr)).find((x) => x * pps >= 7 && Math.abs(step / x - Math.round(step / x)) < 1e-6) || null;
  const ticks = [], minors = [];
  if (dur > 0) {
    const t0 = Math.max(0, vs), t1 = Math.min(dur, vs + span);
    for (let k = Math.ceil(t0 / step - 1e-9); k * step <= t1 + 1e-9 && ticks.length < 80; k++) ticks.push(k * step);
    if (minor) for (let k = Math.ceil(t0 / minor - 1e-9); k * minor <= t1 + 1e-9 && minors.length < 400; k++) {
      const t = k * minor;
      if (Math.abs(t / step - Math.round(t / step)) > 1e-6) minors.push(t);
    }
  }
  const clipStyle = { left: xp(0), width: `${(dur / span) * 100}%` };

  return (
    <div className="m-track" ref={el} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      <div className="m-ruler">
        {minors.map((t) => <i key={`m${t}`} className="m-minor" style={{ left: xp(t) }} />)}
        {ticks.map((t) => <span key={t} style={{ left: xp(t) }}>{rulerLabel(t, step)}</span>)}
      </div>
      <div className="m-clock">{clock}</div>
      <div className="m-lane m-sound">
        {dur > 0 && <div className="m-sound-bg" style={clipStyle} />}
        {dur > 0 && <Wave peaks={peaks || flatPeaks} muted={!peaks} dur={dur} vs={vs} span={span} variant={waveStyle} tint={waveTint} low={waveLow} fine />}
      </div>
      <div className="m-head" />
      {dur > 0 && <div className="m-marks">{tops.map((c) => (
        <Marker key={c.id} c={c} n={numberOf[c.id]} sel={sel === c.id} left={xp(c.t)} width={c.t_end ? `${((c.t_end - c.t) / span) * 100}%` : null}
          onDown={(e) => { e.stopPropagation(); onPick(c); }} />
      ))}</div>}
      <button className="m-add" onPointerDown={(e) => e.stopPropagation()} onClick={onAdd}
        aria-label={pending ? 'Commenter avec les dessins' : 'Ajouter un commentaire à ce moment'}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {pending > 0 && <i>{pending}</i>}
      </button>
    </div>
  );
}

// icônes (traits fins, héritent de la couleur du texte)

// API iframe YouTube, chargée une seule fois
let ytReady;
const loadYT = () => (ytReady ??= new Promise((ok) => {
  if (window.YT?.Player) return ok(window.YT);
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { prev?.(); ok(window.YT); };
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}));

// lecteur YouTube adapté à l'API d'un <video> (pause, lecture, position, durée, son)
function createYtShim({ host, videoId, box, onDuration, onState, onTime }) {
  let player, poll, dead = false, intentPaused = true, paused = true, muted = false, t = 0, d = 0, lastSeek = 0;
  const shim = {
    get paused() { return paused; },
    get duration() { return d; },
    get currentTime() { return t; },
    set currentTime(x) { t = x; lastSeek = performance.now(); player?.seekTo?.(x, true); },
    pause() { intentPaused = true; player?.pauseVideo?.(); },
    play() { intentPaused = false; player?.playVideo?.(); return Promise.resolve(); },
    get muted() { return muted; },
    set muted(v) { muted = !!v; if (player?.mute) (muted ? player.mute() : player.unMute()); },
    videoWidth: 16, videoHeight: 9, // YouTube ne donne pas la taille : on suppose du 16:9
    get clientWidth() { return box()?.clientWidth || 0; },
    get clientHeight() { return box()?.clientHeight || 0; },
  };
  loadYT().then((YT) => {
    if (dead) return;
    player = new YT.Player(host, {
      videoId,
      playerVars: { controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, origin: location.origin },
      events: {
        onReady: () => {
          if (muted) player.mute();
          const tryDur = () => {
            const x = player.getDuration();
            if (x > 0) { d = x; onDuration?.(x); } else if (!dead) setTimeout(tryDur, 250);
          };
          tryDur();
        },
        onStateChange: (e) => {
          const st = e.data; // 1 lecture, 2 pause, 3 mise en mémoire, 0 fin
          if (st === 1 && intentPaused) { player.pauseVideo(); return; } // un seekTo ne doit pas lancer la lecture
          paused = !(st === 1 || st === 3);
          onState?.(st);
        },
      },
    });
    poll = setInterval(() => {
      if (!player?.getCurrentTime || performance.now() - lastSeek < 350) return;
      const c = player.getCurrentTime();
      if (Math.abs(c - t) > 0.001) { t = c; onTime?.(c); }
    }, 40);
  });
  return { shim, destroy() { dead = true; clearInterval(poll); try { player?.destroy(); } catch {} host.remove(); } };
}

export default function Review({ aid, title, admin, back = null, deadline = null, initialFps, initialPeaks, source, videoId, mediaUrl = null, download = null, fileBytes = null, versions = [], currentN = 1, latestN = 1, initialStatus = null, initialCompare = null }) {
  const isYt = source === 'youtube';
  const sessionKey = `review-session:${aid}:${currentN}`, sourceIdentity = `${source}:${videoId}`;
  const [remembered] = useState(() => readSession(sessionKey, sourceIdentity));
  const restored = useRef(false), latestSession = useRef(null);
  const [capturing, setCapturing] = useState(false), [captureMessage, setCaptureMessage] = useState('');
  const navigate = useNavigate();
  const [approval, setApproval] = useState(initialStatus);
  const [needName, setNeedName] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);  // ratio réel de la vidéo (16:9 par défaut)
  const [fit, setFit] = useState(null);         // taille du cadre vidéo : le plus grand rectangle de ce ratio qui tient
  const [nativeSize, setNativeSize] = useState(null);
  const [monitorBarHeight, setMonitorBarHeight] = useState(44);
  const [expanded, setExpanded] = useState(false);
  const mobile = useMedia('(max-width: 760px)');
  const [sheet, setSheet] = useState(null);      // tiroir des commentaires : null | 'list' | 'compose'
  const noteRef = useRef(null);
  const [compareN, setCompareN] = useState(initialCompare); // version affichée à droite, ou null
  const [slaveDur, setSlaveDur] = useState(0);
  const [soundFrom, setSoundFrom] = useState('a');           // 'a' = version courante, 'b' = version comparée
  // seules les autres versions vidéo se comparent (une v2 en PDF ne se lit pas côte à côte)
  const cmpable = versions.filter((x) => x.n !== currentN && (!x.kind || x.kind === 'video'));
  const other = compareN ? cmpable.find((x) => x.n === compareN) || null : null;
  const otherYt = other?.source === 'youtube';
  const slaveDurRef = useRef(0); slaveDurRef.current = slaveDur;
  const vid = useRef(null);
  const wrap = useRef(null);
  const ytWrap = useRef(null);
  const slaveRef = useRef(null);      // second lecteur (élément <video> ou adaptateur YouTube)
  const slaveWrap = useRef(null);
  const slaveYtWrap = useRef(null);
  const vstage = useRef(null);
  const track = useRef(null);
  const deepLink = useRef(null);

  const [comments, setComments] = useState([]);
  const [dur, setDur] = useState(0);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [fps, setFps] = useState(initialFps || null);
  const [probing, setProbing] = useState(false);
  const [pro, setPro] = useState(false);
  const [view, setView] = useState({ s: 0, span: 0 });
  const [hover, setHover] = useState(null);
  const [peaks, setPeaks] = useState(() => decodePeaks(initialPeaks));
  const [waving, setWaving] = useState(false);
  const [peaksError, setPeaksError] = useState(false); // l'onde est calculée mais pas enregistrée
  const [needLocalWave, setNeedLocalWave] = useState(false); // fichier trop lourd : l'onde doit venir du fichier sur l'ordinateur
  const [waveMsg, setWaveMsg] = useState('');
  const [videoErr, setVideoErr] = useState(false);          // 'drive' (partage retiré…), 'quota' (Drive limite le fichier) ou 'format' (codec illisible)
  const [buffering, setBuffering] = useState(false);
  const [fileSize, setFileSize] = useState(null);           // taille du fichier Drive (pour prévenir l'hôte)
  const [waveStyle, setWaveStyle] = useState('bars');
  const [waveTint, setWaveTint] = useState('vol');
  const [waveLow, setWaveLow] = useState(false);           // onde posée en bas de la piste
  const [stepMode, setStepMode] = useState('frame'); // pas des flèches : 'frame' | 'second'

  const [name, setName] = useState('');
  const [nameOk, setNameOk] = useState(false);
  const [editName, setEditName] = useState(false);
  const [sel, setSel] = useState(null);

  // brouillon de commentaire (positions en numéro d'image → précision à la frame)
  const [body, setBody] = useState('');
  const [stampF, setStampF] = useState(0);
  const [endF, setEndF] = useState(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tool, setTool] = useState(null);
  const [color, setColor] = useState(COLORS[0]);
  const [pin, setPin] = useState(null);
  const [shapes, setShapes] = useState([]);
  const [redoStack, setRedoStack] = useState([]); // dessins annulés, à refaire (mobile)
  const [draft, setDraft] = useState(null);
  const [muted, setMuted] = useState(false);
  const [dlUrl, setDlUrl] = useState(download); // lien de téléchargement de la version (Drive…)

  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [status, setStatus] = useState('all');
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [author, setAuthor] = useState('');
  const [q, setQ] = useState('');

  const F = fps || 25;
  const Ff = useRef(F); Ff.current = F;
  const durRef = useRef(0); durRef.current = dur;
  const stepRef = useRef(stepMode); stepRef.current = stepMode;

  const frameOf = (t) => Math.floor(t * F + 1e-4);
  const base = Math.round(F);
  const tcFull = (t) => {
    const f = frameOf(t), sec = Math.floor(f / base);
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}:${pad(f % base)}`;
  };
  const tcSimple = (t) => { const s = Math.floor(t + 1e-4); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
  const label = pro ? tcFull : tcSimple;
  const rangeLabel = (c) => (c.t_end ? `${label(c.t)} → ${label(c.t_end)}` : label(c.t));
  const curF = frameOf(now);

  // les commentaires arrivent en temps réel (Firestore) : plus rien à recharger après une action
  useEffect(() => data.subscribeComments(aid, currentN, (list) => setComments(list.map(parse)), () => {}), [aid, currentN]);

  useEffect(() => {
    try {
      const n = localStorage.getItem('review-name') || '';
      setName(n); setNameOk(!!n);
      setPro(localStorage.getItem('review-pro') === '1');
      if (localStorage.getItem('review-step') === 'second') setStepMode('second');
      const ws = localStorage.getItem('review-wave');
      if (WAVE_STYLES.some(([k]) => k === ws)) setWaveStyle(ws);
      if (ws === 'low' || localStorage.getItem('review-wavelow') === '1') setWaveLow(true); // ancien style « Bas »
      if (localStorage.getItem('review-wavetint') === 'flat') setWaveTint('flat');
      if (!initialFps) { const f = Number(localStorage.getItem(`fps:${aid}:${currentN}`)); if (f) setFps(f); }
    } catch {}
    const c = new URLSearchParams(location.search).get('c');
    if (c) deepLink.current = c;
  }, [aid, currentN, initialFps]);

  // pas d'effet de bord dans les updaters React (ils peuvent être rejoués)
  const setStepTo = useCallback((n) => {
    try { localStorage.setItem('review-step', n); } catch {}
    setStepMode(n);
  }, []);
  const toggleStep = useCallback(() => setStepTo(stepRef.current === 'frame' ? 'second' : 'frame'), [setStepTo]);
  const savePref = (key, val, set) => { try { localStorage.setItem(key, val); } catch {} set(val); };
  const togglePro = () => {
    try { localStorage.setItem('review-pro', pro ? '0' : '1'); } catch {}
    setPro(!pro);
  };

  // zone réellement occupée par l'image dans le <video> (object-fit: contain)
  const measure = useCallback(() => {
    const v = vid.current;
    if (!v || !v.videoWidth) return;
    const cw = v.clientWidth, ch = v.clientHeight;
    const s = Math.min(cw / v.videoWidth, ch / v.videoHeight);
    const w = v.videoWidth * s, h = v.videoHeight * s;
    setBox({ x: (cw - w) / 2, y: (ch - h) / 2, w, h });
    if (!isYt) setNativeSize((prev) => prev?.w === v.videoWidth && prev?.h === v.videoHeight ? prev : { w: v.videoWidth, h: v.videoHeight });
    const r = v.videoWidth / v.videoHeight;
    if (r > 0.2 && r < 6) setRatio((cur) => (Math.abs(cur - r) < 0.001 ? cur : r));
  }, [isYt]);
  useEffect(() => {
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [measure]);

  // cadre vidéo : le plus grand rectangle du ratio de la vidéo qui tient dans la zone (1 ou 2 volets)
  useEffect(() => {
    const el = vstage.current;
    if (!el) return;
    const calc = () => {
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = Math.max(1, el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - monitorBarHeight);
      if (!w || !h) return;
      const mobile = window.innerWidth <= 900, gap = 12;
      const cols = compareN && !mobile ? 2 : 1;
      const bw = (w - gap * (cols - 1)) / cols;
      // lecteur mobile plein écran : la vidéo tient aussi en hauteur (vidéos verticales)
      const pw = Math.min(bw, mobile && !el.closest('.review.mobile') ? Infinity : h * ratio);
      const nw = Math.floor(pw), nh = Math.floor(pw / ratio);
      setFit((f) => (f && f.w === nw && f.h === nh && f.availableW === bw ? f : { w: nw, h: nh, availableW: bw }));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    window.addEventListener('resize', calc);
    return () => { ro.disconnect(); window.removeEventListener('resize', calc); };
  }, [compareN, ratio, monitorBarHeight]);

  // --- déplacement à l'image près : on vise le milieu de l'image pour éviter les erreurs d'arrondi ---
  const scrub = useRef({ last: 0, pending: null, timer: null });
  const seekF = useCallback((f) => {
    const sc = scrub.current;
    clearTimeout(sc.timer); sc.pending = null; sc.last = performance.now(); // tout déplacement annule le scrub en attente
    const v = vid.current;
    if (!v) return;
    const max = Math.max(0, Math.ceil((v.duration || 0) * Ff.current) - 1);
    const t = (clamp(f, 0, max) + 0.5) / Ff.current;
    v.pause();
    v.currentTime = t;
    setNow(t);
    const sl = slaveRef.current;
    if (sl) sl.currentTime = Math.max(0, Math.min(t, (slaveDurRef.current || Infinity) - 0.05));
  }, []);
  const seekT = useCallback((t) => seekF(Math.round(t * Ff.current)), [seekF]);
  const scrubTo = useCallback((f, final = false) => {
    const sc = scrub.current;
    clearTimeout(sc.timer);
    f = clamp(f, 0, Math.max(0, Math.ceil((vid.current?.duration || 0) * Ff.current) - 1));
    if (final || performance.now() - sc.last > 250) { seekF(f); return; }
    sc.pending = f;
    setNow((f + 0.5) / Ff.current); // la tête de lecture suit tout de suite
    sc.timer = setTimeout(() => { if (sc.pending != null) seekF(sc.pending); }, 250);
  }, [seekF]);
  const flushScrub = useCallback(() => { const p = scrub.current.pending; if (p != null) seekF(p); }, [seekF]);
  useEffect(() => () => clearTimeout(scrub.current.timer), []);
  const stepF = useCallback((d) => { if (vid.current) seekF((scrub.current.pending ?? Math.floor(vid.current.currentTime * Ff.current + 1e-4)) + d); }, [seekF]);
  // flèches : pas selon le mode choisi, Maj = l'autre mode le temps d'un appui
  const stepBy = useCallback((dir, invert = false, held = false) => {
    const perFrame = (stepRef.current === 'frame') !== invert;
    const d = dir * (perFrame ? 1 : Math.round(Ff.current));
    if (!held) return stepF(d);
    // touche maintenue : on avance depuis la position affichée, la vidéo suit au plus 4 fois par seconde
    const base = scrub.current.pending ?? Math.floor(vid.current.currentTime * Ff.current + 1e-4);
    scrubTo(base + d);
  }, [stepF, scrubTo]);

  const onMeta = async (v) => {
    setDur(v.duration);
    measure();
    if (!fps && !isYt) {
      setProbing(true);
      const f = await detectFps(v);
      setProbing(false);
      const val = f || 25;
      setFps(val);
      if (f) {
        try { localStorage.setItem(`fps:${aid}:${currentN}`, String(f)); } catch {}
        if (admin) data.saveVersion(aid, currentN, { fps: f }).catch(() => {});
      }
    }
  };

  // --- source YouTube : lecteur intégré, adapté pour ressembler à un <video> ---
  useEffect(() => {
    if (!isYt) return;
    const host = document.createElement('div');
    ytWrap.current.appendChild(host);
    const { shim, destroy } = createYtShim({
      host, videoId, box: () => wrap.current,
      onDuration: (x) => { setDur(x); measure(); },
      onState: (st) => { setPlaying(st === 1 || st === 3); if (st === 1) setSel(null); }, // la mise en mémoire compte comme lecture
      onTime: (c) => { if (scrub.current.pending == null) setNow(c); },
    });
    vid.current = shim;
    return () => { destroy(); vid.current = null; };
  }, [isYt, videoId, measure]);

  // --- comparaison : second lecteur YouTube (le cas fichier utilise un <video> rendu dans le JSX) ---
  useEffect(() => {
    if (!compareN || !otherYt) return;
    const host = document.createElement('div');
    slaveYtWrap.current.appendChild(host);
    const { shim, destroy } = createYtShim({ host, videoId: other.videoId, box: () => slaveWrap.current, onDuration: (x) => setSlaveDur(x) });
    slaveRef.current = shim;
    return () => { destroy(); slaveRef.current = null; setSlaveDur(0); };
  }, [compareN, otherYt, other?.videoId]);

  // lecture / pause du maître → le second lecteur suit et se cale sur la même position
  useEffect(() => {
    const sl = slaveRef.current, m = vid.current;
    if (!compareN || !sl || !m) return;
    const t = Math.max(0, Math.min(m.currentTime, (slaveDurRef.current || Infinity) - 0.05));
    if (playing) { sl.currentTime = t; sl.play?.()?.catch?.(() => {}); } else { sl.pause?.(); sl.currentTime = t; }
  }, [playing, compareN, slaveDur]);

  // pendant la lecture : on recale le second lecteur dès qu'il dérive
  useEffect(() => {
    if (!compareN || !playing) return;
    const limit = otherYt ? 0.5 : 0.2;
    const id = setInterval(() => {
      const sl = slaveRef.current, m = vid.current;
      if (!sl || !m) return;
      const target = Math.min(m.currentTime, (slaveDurRef.current || Infinity) - 0.05);
      if (Math.abs(sl.currentTime - target) > limit) sl.currentTime = target;
    }, 400);
    return () => clearInterval(id);
  }, [compareN, playing, otherYt]);

  // le son vient d'un seul côté
  useEffect(() => {
    const m = vid.current, sl = slaveRef.current;
    if (!compareN) { if (m) m.muted = false; return; }
    if (m) m.muted = soundFrom === 'b';
    if (sl) sl.muted = soundFrom === 'a';
  }, [compareN, soundFrom, slaveDur, dur]);

  // vue de la timeline : tout visible au départ, zoomable
  useEffect(() => { if (dur > 0) setView({ s: 0, span: dur }); }, [dur]);
  useEffect(() => {
    if (!dur || probing || restored.current) return;
    const frame = requestAnimationFrame(() => {
      restored.current = true;
      if (new URLSearchParams(location.search).has('c')) return;
      if (Number.isFinite(remembered?.t)) seekF(Math.floor(clamp(remembered.t, 0, Math.max(0, dur - 1 / F)) * F + 1e-4));
      if (Number.isFinite(remembered?.view?.span) && remembered.view.span > 0 && Number.isFinite(remembered?.view?.s)) {
        const span = clamp(remembered.view.span, Math.min(dur, 12 / F), dur);
        setView({ s: clamp(remembered.view.s, 0, dur - span), span });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [dur, probing, remembered, seekF, F]);
  latestSession.current = { source: sourceIdentity, t: now, view, ready: dur > 0 && !probing };
  useEffect(() => {
    const save = () => { const value = latestSession.current; if (restored.current && value?.ready) writeSession(sessionKey, { source: value.source, t: value.t, view: value.view }); };
    const timer = setInterval(save, 1000);
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', save);
    return () => { save(); clearInterval(timer); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', save); };
  }, [sessionKey]);
  const span = view.span || dur || 1;
  const vs = view.s;
  const xp = (t) => `${((t - vs) / span) * 100}%`;

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onWheel = (e) => {
      const D = durRef.current;
      if (!D) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ratio = clamp((e.clientX - r.left) / r.width);
      setView((v) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return { ...v, s: clamp(v.s + (e.deltaX / r.width) * v.span, 0, D - v.span) };
        const minSpan = Math.min(D, 12 / Ff.current);
        const sp = clamp(v.span * (e.deltaY > 0 ? 1.2 : 1 / 1.2), minSpan, D);
        const tAt = v.s + ratio * v.span;
        return { s: clamp(tAt - ratio * sp, 0, D - sp), span: sp };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mobile]);
  const zoomBy = (k) => setView((v) => {
    const D = dur, minSpan = Math.min(D, 12 / F);
    const sp = clamp(v.span * k, minSpan, D);
    const ratio = clamp((now - v.s) / v.span);
    return { s: clamp(now - ratio * sp, 0, D - sp), span: sp };
  });
  // la vue suit la tête de lecture
  useEffect(() => {
    if (!dur) return;
    setView((v) => (now < v.s || now > v.s + v.span ? { ...v, s: clamp(now - 0.1 * v.span, 0, dur - v.span) } : v));
  }, [now, dur]);

  const ticks = useMemo(() => {
    if (!dur) return { out: [], step: 1 };
    const cands = [1 / F, 2 / F, 5 / F, 10 / F, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
    const step = cands.find((c) => span / c <= 14) || 1800;
    const out = [];
    for (let t = Math.ceil(vs / step - 1e-6) * step; t <= vs + span + 1e-9; t += step) out.push(t);
    return { out, step };
  }, [dur, F, span, vs]);
  const tickLabel = (t) => {
    if (ticks.step >= 1) return tcSimple(t);
    const f = frameOf(t), sec = Math.floor(f / base);
    return `${Math.floor(sec / 60)}:${pad(sec % 60)}+${f % base}`;
  };

  const timeAt = (e) => {
    const r = track.current.getBoundingClientRect();
    return vs + clamp((e.clientX - r.left) / r.width) * span;
  };

  // lien direct ?c=ID
  useEffect(() => {
    if (deepLink.current && dur > 0) {
      const c = comments.find((x) => x.id === deepLink.current);
      if (c) { deepLink.current = null; setSel(c.id); seekT(c.t); }
    }
  }, [comments, dur, seekT]);

  // enregistre l'onde sur le serveur et le confirme ; sinon l'avertit (elle disparaîtrait au rechargement)
  const savePeaks = async (p) => {
    try {
      await data.saveVersion(aid, currentN, { peaks: encodePeaks(p) });
      setPeaksError(false);
      return true;
    } catch {}
    setPeaksError(true);
    return false;
  };

  // taille du fichier Drive : sert à décider comment calculer l'onde et à prévenir l'hôte des fichiers lourds
  useEffect(() => {
    if (source !== 'drive' || !admin) return;
    let dead = false;
    // -1 = taille inconnue (requête refusée, par ex. blocage Google) : on n'attend pas indéfiniment
    driveMeta(videoId).then((m) => { if (!dead) setFileSize(m?.size ?? -1); });
    return () => { dead = true; };
  }, [source, videoId, admin]);

  const AUTO_WAVE_MAX = 300e6; // au-delà, télécharger tout le fichier pour en extraire le son n'est pas raisonnable
  const wavedRef = useRef(false);
  useEffect(() => {
    if (isYt || !admin || peaks || wavedRef.current || !Number.isFinite(dur) || dur <= 0) return;
    if (source === 'drive' && fileSize == null) return; // on attend la taille
    wavedRef.current = true;
    if ((source === 'file' ? fileBytes : fileSize) > AUTO_WAVE_MAX) { setNeedLocalWave(true); return; }
    setWaving(true);
    (async () => {
      try {
        const p = await computePeaks(vid.current.currentSrc, dur);
        if (p) { setPeaks(p); await savePeaks(p); } else setNeedLocalWave(true);
      } catch { setNeedLocalWave(true); } finally { setWaving(false); }
    })();
  }, [admin, peaks, dur, aid, currentN, fileSize, source]);

  // YouTube : onde calculée depuis le fichier source de l'admin (local, jamais envoyé), seuls les pics sont enregistrés
  const peaksFromFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !dur) return;
    setWaving(true); setWaveMsg('');
    let p = null, err = null;
    try {
      p = await peaksFromLocalMp4(file, dur, (x) => setWaveMsg(`${Math.round(x * 100)} %`));
    } catch (ex) {
      err = ex;
      // pas un MP4/MOV lisible par morceaux : méthode simple si le fichier tient en mémoire
      if (file.size <= 400e6) { // limite réelle de la méthode simple (tout le fichier en mémoire)
        const url = URL.createObjectURL(file);
        try { p = await computePeaks(url, dur); } catch {} finally { URL.revokeObjectURL(url); }
      }
    }
    setWaving(false); setWaveMsg('');
    if (p) { setPeaks(p); setNeedLocalWave(false); await savePeaks(p); }
    else alert(`Impossible de lire le son de ce fichier.${err ? `\n${err.message}` : ''}`);
  };

  const drawing = shapes.length > 0 || !!pin || !!draft;
  // sans brouillon, le commentaire suit la tête de lecture
  useEffect(() => {
    if (!drawing && !body.trim() && endF == null) setStampF(curF);
  }, [curF, drawing, body, endF]);

  const beginCompose = () => { vid.current?.pause(); };
  const pickTool = (t) => { beginCompose(); setTool((cur) => (cur === t ? null : t)); };
  const toggleTools = () => { setToolsOpen((o) => { if (o) setTool(null); else vid.current?.pause(); return !o; }); };
  // annuler / refaire le dernier dessin du brouillon
  const undoDraw = () => {
    if (shapes.length) { const last = shapes[shapes.length - 1]; setShapes(shapes.slice(0, -1)); setRedoStack((r) => [...r, { shape: last }]); }
    else if (pin) { setRedoStack((r) => [...r, { pin }]); setPin(null); }
  };
  const redoDraw = () => {
    const it = redoStack[redoStack.length - 1];
    if (!it) return;
    setRedoStack(redoStack.slice(0, -1));
    if (it.pin) setPin(it.pin); else setShapes((s) => [...s, it.shape]);
  };
  const toggleMute = () => { const v = vid.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); };

  // --- dessin ---
  const point = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  };
  const onDown = (e) => {
    if (!tool) return;
    if (!draftHere && (shapes.length || pin)) { seekF(stampF); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setRedoStack([]);
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

  const resetDraft = () => { setBody(''); setEndF(null); setTool(null); setToolsOpen(false); setPin(null); setShapes([]); setRedoStack([]); setDraft(null); };

  // le commentaire d'un client déclenche une notification push chez l'hôte
  const post = async (payload) => {
    const cid = await data.addComment(aid, currentN, { author: name, ...payload });
    if (!admin) notifyHost({ aid, n: currentN, cid, kind: 'comment' });
    return cid;
  };
  const remember = () => { try { localStorage.setItem('review-name', name); } catch {} setNameOk(true); setEditName(false); };

  const [marking, setMarking] = useState(false);
  const markerRef = useRef(null);
  const addMarker = async () => {
    vid.current?.pause();
    const f = scrub.current.pending ?? curF;
    flushScrub();
    if (!name.trim()) { setStampF(f); setNeedName(true); setEditName(true); setBody('Repère'); setSheet('compose'); return; }
    setMarking(true);
    try { const cid = await post({ body: 'Repère', t: f / F, t_end: null, shapes: [] }); remember(); setSel(cid); }
    catch { alert('Le repère n’a pas pu être posé (accès refusé ou review désactivée).'); }
    setMarking(false);
  };
  markerRef.current = addMarker;

  // hôte : attacher / changer le lien de téléchargement de cette version
  const editDownload = async () => {
    const raw = prompt('Lien de téléchargement de cette version (lien Drive du fichier). Vide = retirer.', dlUrl || '');
    if (raw == null) return;
    const url = raw.trim() ? cleanDownloadUrl(raw) : null;
    if (raw.trim() && !url) { alert('Lien invalide : il doit commencer par https://'); return; }
    try { await data.saveVersion(aid, currentN, { download: url }); setDlUrl(url); } catch { alert('Le lien n’a pas pu être enregistré.'); }
  };
  const downloadBtn = dlUrl
    ? <a className="ghost-link dl-btn" href={dlUrl} target="_blank" rel="noopener noreferrer">Télécharger</a>
    : null;

  const send = async () => {
    if (!body.trim() || !name.trim()) return;
    remember();
    try { await post({ body, t: stampF / F, t_end: endF != null ? endF / F : null, x: pin?.[0], y: pin?.[1], shapes }); } catch { alert('Le commentaire n’a pas pu être envoyé (accès refusé ou review désactivée).'); return; }
    resetDraft();
  };
  const sendReply = async () => {
    if (!replyText.trim() || !name.trim()) return;
    remember();
    try { await post({ body: replyText, parent_id: replyTo }); } catch { alert('La réponse n’a pas pu être envoyée.'); return; }
    setReplyText(''); setReplyTo(null);
  };
  // validation de la version : approuver, demander des modifications, ou annuler
  const setReview = async (st) => {
    if (st && !name.trim()) { setEditName(true); setNeedName(true); return; }
    try { await data.setApproval(aid, currentN, st, name.trim()); } catch { return; }
    if (st && !admin) notifyHost({ aid, n: currentN, kind: 'status' });
    if (st) remember();
    setNeedName(false);
    setApproval(st ? { status: st, by: name.trim(), at: Date.now() } : null);
  };
  const syncUrl = (n) => {
    try { const u = new URL(location.href); if (n) u.searchParams.set('cmp', n); else u.searchParams.delete('cmp'); history.replaceState(null, '', u); } catch {}
  };
  const setCmp = (n) => { setCompareN(n); syncUrl(n); };
  const toggleCompare = () => {
    if (compareN) return setCmp(null);
    const others = cmpable;
    // par défaut : la version juste avant (ou la plus récente si on regarde une ancienne)
    const pick = currentN === latestN ? others[others.length - 1] : others.find((x) => x.n === latestN) || others[others.length - 1];
    if (pick) setCmp(pick.n);
  };
  const goVersion = (n) => navigate(`/r/${aid}?v=${n}${compareN && compareN !== n ? `&cmp=${compareN}` : ''}`);
  const fmtDay = (t) => new Date(t).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
  const fmtWhen = (t) => new Date(t).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const toggle = async (c) => {
    data.setResolved(aid, currentN, c.id, !c.resolved).catch(() => {});
  };
  const del = async (c) => {
    if (!confirm('Supprimer ce commentaire ?')) return;
    data.deleteComment(aid, currentN, c.id).catch(() => {});
  };
  // actions groupées sur une zone
  const resolveAll = (items) => items.filter((c) => !c.resolved).forEach((c) => data.setResolved(aid, currentN, c.id, true).catch(() => {}));
  const deleteAll = (items) => {
    if (!confirm(`Supprimer ces ${items.length} éléments ?`)) return;
    items.forEach((c) => data.deleteComment(aid, currentN, c.id).catch(() => {}));
  };
  const copyLink = (c) => { try { navigator.clipboard.writeText(`${location.origin}${location.pathname}?c=${c.id}`); } catch {} };
  // erreur de lecture : codec illisible, quota Drive du fichier dépassé, ou fichier inaccessible
  const onVideoError = async (code) => {
    if (code === 3) return setVideoErr('format');
    try {
      const r = await fetch(videoUrl(source, videoId, mediaUrl), { headers: { Range: 'bytes=0-1' } });
      if (!r.ok) {
        const reason = (await r.json().catch(() => null))?.error?.errors?.[0]?.reason;
        return setVideoErr(reason === 'downloadQuotaExceeded' ? 'quota' : 'drive');
      }
    } catch {}
    setVideoErr('drive');
  };
  const retryVideo = () => {
    const v = vid.current;
    if (!v) return;
    const t = v.currentTime;
    setVideoErr(false); setBuffering(false);
    v.load();
    if (t > 0) v.addEventListener('loadedmetadata', () => seekT(t), { once: true });
  };
  const playPause = () => { flushScrub(); const v = vid.current; v.paused ? v.play() : v.pause(); };

  // --- clavier : image par image, toujours actif ---
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !vid.current) return;
      if (e.key === ' ') { e.preventDefault(); playPause(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepBy(-1, e.shiftKey, e.repeat); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepBy(1, e.shiftKey, e.repeat); }
      else if (e.key === 's' || e.key === 'S') { toggleStep(); }
      else if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); markerRef.current?.(); }
      else if (e.key === 'Escape') { setTool(null); setExpanded(false); }
    };
    // touche relâchée : la vidéo rejoint tout de suite la position affichée
    const onUpKey = (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') flushScrub(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUpKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUpKey); };
  }, [stepBy, toggleStep, flushScrub]);

  // --- données dérivées ---
  const tops = useMemo(() => comments.filter((c) => !c.parent_id), [comments]);
  const kids = useCallback((id) => comments.filter((c) => c.parent_id === id), [comments]);
  const numberOf = useMemo(() => Object.fromEntries(tops.map((c, i) => [c.id, i + 1])), [tops]);
  const authors = useMemo(() => [...new Set(comments.map((c) => c.author))], [comments]);

  const shown = tops.filter((c) => {
    if (status === 'open' && c.resolved) return false;
    if (status === 'done' && !c.resolved) return false;
    if (onlyMarked && !hasMarks(c) && c.body !== 'Repère') return false;
    const thread = [c, ...kids(c.id)];
    if (author && !thread.some((x) => x.author === author)) return false;
    if (q && !thread.some((x) => x.body.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  // Un dessin appartient à une image précise : il s'affiche à l'arrêt sur cette image, et sur toute la plage
  // pour un commentaire « In/Out ». YouTube ne se cale pas à l'image près : on tolère 2 images d'écart.
  const tol = isYt ? 2 : 0;
  const atFrame = (a, b) => (b != null ? curF >= a - tol && curF <= b + tol : !playing && Math.abs(curF - a) <= tol);
  const visible = tops.filter((c) => hasMarks(c) && atFrame(Math.round(c.t * F), c.t_end ? Math.round(c.t_end * F) : null));
  // le dessin en cours appartient à l'image du commentaire en préparation
  const draftHere = atFrame(stampF, endF);
  const capture = async () => {
    if (capturing || isYt) return;
    setCapturing(true); setCaptureMessage('');
    try {
      flushScrub(); const video = vid.current; video.pause();
      if (video.seeking) await new Promise((resolve, reject) => {
        const finish = () => { clearTimeout(timer); video.removeEventListener('seeked', finish); resolve(); };
        const timer = setTimeout(() => { video.removeEventListener('seeked', finish); reject(new Error('La frame n’est pas prête. Réessaie.')); }, 8000);
        video.addEventListener('seeked', finish, { once: true });
      });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const overlay = wrap.current?.querySelector('.ov svg')?.cloneNode(true);
      const pins = [...(wrap.current?.querySelectorAll('.ov .pin') || [])].map((el) => ({ x: parseFloat(el.style.left) / 100, y: parseFloat(el.style.top) / 100, label: el.textContent, draft: el.classList.contains('draft') }));
      const time = video.currentTime;
      await captureAnnotatedFrame({ video, time, overlay, pins, filename: `${title.replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 80) || 'capture'}-v${currentN}-${tcFull(time).replaceAll(':', '-')}.png` });
      setCaptureMessage('Image téléchargée.');
    } catch (e) { setCaptureMessage(e.message || 'La capture a échoué.'); } finally { setCapturing(false); }
  };

  // Timeline : clic / glisser = déplacement ; Maj + clic-glisser = plage de commentaire.
  const [selecting, setSelecting] = useState(false);
  const press = useRef(null);
  const onTrackDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const f = clamp(Math.floor(timeAt(e) * F), 0, Math.max(0, Math.ceil(dur * F) - 1));
    scrubTo(f, true);
    const p = { startF: e.shiftKey ? curF : f, pressedF: f, currentF: f, x0: e.clientX, selecting: e.shiftKey };
    if (p.selecting) {
      vid.current?.pause();
      setSel(null); setStampF(Math.min(p.startF, f)); setEndF(p.startF === f ? null : Math.max(p.startF, f)); setSelecting(true);
    }
    press.current = p;
  };
  const onTrackMove = (e) => {
    setHover({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, t: timeAt(e) });
    const p = press.current;
    if (!p || e.buttons !== 1) return;
    const f = clamp(Math.floor(timeAt(e) * F), 0, Math.max(0, Math.ceil(dur * F) - 1));
    p.currentF = f;
    if (p.selecting) {
      if (Math.abs(e.clientX - p.x0) > 4) p.startF = p.pressedF;
      // la zone va de l'appui jusqu'au pointeur, dans un sens ou dans l'autre
      setStampF(Math.min(p.startF, f)); setEndF(f === p.startF ? null : Math.max(p.startF, f));
      return;
    }
    scrubTo(f);
  };
  const onTrackUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (!p.selecting) { flushScrub(); return; }
    setSelecting(false);
    seekF(Math.min(p.startF, p.currentF)); // la tête se cale au début de la zone
    setToolsOpen(true); // Le commentaire et les dessins utilisent désormais cette plage.
  };

  const askName = !nameOk || editName;
  const draftLabel = endF != null ? `${label(stampF / F)} → ${label(endF / F)}` : label(stampF / F);

  const flatPeaks = useMemo(() => ({ l: new Uint8Array(400).fill(16), r: null }), []); // onde plate de remplacement

  // blocs partagés par la mise en page ordinateur et la mise en page mobile
  const monitorView = (
        <div className={`vstage ${compareN ? 'two' : ''}`} ref={vstage} style={{ '--monitor-toolbar-h': `${monitorBarHeight}px` }}>
        <VideoMonitor aid={aid} viewportRef={wrap} fit={fit} nativeSize={nativeSize} box={box} playing={playing} onPlay={playPause} onStep={stepF} toolsOpen={toolsOpen} onTools={toggleTools} drawingTools={<DrawingToolbar only={['arrow', 'pen', 'circle', 'rect']} tool={tool} onTool={pickTool} color={color} onColor={setColor} canUndo={!!shapes.length || !!pin} onUndo={() => shapes.length ? setShapes((items) => items.slice(0, -1)) : setPin(null)} />} onToolbarHeight={setMonitorBarHeight} sessionKey={sessionKey} sourceIdentity={sourceIdentity} ready={dur > 0} onCapture={capture} captureDisabled={isYt || source === 'drive'} capturing={capturing}>
          {compareN && <span className="pane-tag">v{currentN}</span>}
          {isYt ? (
            <>
              <div className="ytframe" ref={ytWrap} />
              <div className="ytshield" onClick={playPause} />
            </>
          ) : source === 'drive' ? (
            // vidéos Drive retirées : Google bloque la lecture des fichiers lourds ; les commentaires restent lisibles
            <div className="vmsg">
              <p><strong>Les vidéos Google Drive ne sont plus lues ici.</strong></p>
              <p className="mut">Google bloque trop souvent la lecture des fichiers lourds. {admin ? 'Ajoute une nouvelle version avec un lien YouTube non répertorié : les commentaires de cette version restent consultables.' : 'Le monteur va partager une nouvelle version.'}</p>
            </div>
          ) : <video ref={vid} src={videoUrl(source, videoId, mediaUrl)} preload="metadata" playsInline
            onClick={playPause}
            onLoadedMetadata={(e) => { setVideoErr(false); onMeta(e.currentTarget); }}
            onTimeUpdate={(e) => { if (scrub.current.pending == null) setNow(e.currentTarget.currentTime); }}
            onSeeked={(e) => { if (scrub.current.pending == null) setNow(e.currentTarget.currentTime); }}
            onPlay={() => { setPlaying(true); setSel(null); }}
            onPause={() => setPlaying(false)}
            onError={(e) => onVideoError(e.currentTarget.error?.code)}
            onEmptied={() => setBuffering(false)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => { setBuffering(false); setVideoErr(false); }}
            onLoadedData={() => setVideoErr(false)}
            onCanPlay={() => { setBuffering(false); setVideoErr(false); }} />}
          {videoErr && (
            <div className="vmsg">
              {videoErr === 'format' ? <>
                <p><strong>Ce format ne se lit pas dans le navigateur.</strong></p>
                <p className="mut">Exporte la vidéo en MP4 (H.264) et partage ce fichier-là.</p>
              </> : videoErr === 'quota' ? <>
                <p><strong>Google Drive bloque ce fichier pour aujourd’hui.</strong></p>
                <p className="mut">Il a été trop téléchargé en 24 h (c’est vite le cas pour un fichier lourd). Ça se débloque tout seul dans la journée. En attendant, partage une version allégée (1080p) ou un lien YouTube non répertorié.</p>
                <button className="ghost sm" onClick={retryVideo}>Réessayer</button>
              </> : <>
                <p><strong>La vidéo ne se charge pas.</strong></p>
                <p className="mut">Google Drive limite parfois la lecture d’un fichier (trop de requêtes en peu de temps, fichier très lourd) ou le partage « avec le lien » a été retiré. Réessaie dans quelques minutes.</p>
                <button className="ghost sm" onClick={retryVideo}>Réessayer</button>
              </>}
            </div>
          )}
          {buffering && !videoErr && <div className="vbuf">Chargement…</div>}
          {probing && <div className="probe">Préparation de la vidéo…</div>}
          <div className="ov" style={{ left: box.x, top: box.y, width: box.w, height: box.h, pointerEvents: tool ? 'auto' : 'none', cursor: tool ? 'crosshair' : 'default' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
            <svg viewBox="0 0 1 1" preserveAspectRatio="none">
              {visible.flatMap((c) => (c.shapes || []).map((s, i) => <Shape key={`${c.id}-${i}`} s={s} box={box} />))}
              {draftHere && shapes.map((s, i) => <Shape key={`d${i}`} s={s} box={box} />)}
              {draft && <Shape s={toShape(draft)} box={box} />}
            </svg>
            {visible.filter((c) => c.x != null).map((c) => (
              <div key={c.id} className="pin" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}><b>{numberOf[c.id]}</b></div>
            ))}
 {pin && draftHere && <div className="pin draft" style={{ left: `${pin[0] * 100}%`, top: `${pin[1] * 100}%` }}><b>+</b></div>}
          </div>
        </VideoMonitor>
        {compareN && other && (
          <div className="vwrap" ref={slaveWrap} style={fit ? { width: fit.w, height: fit.h } : undefined}>
            <span className="pane-tag">v{compareN}</span>
            {otherYt ? (
              <>
                <div className="ytframe" ref={slaveYtWrap} />
                <div className="ytshield" onClick={playPause} />
              </>
            ) : <video ref={slaveRef} src={videoUrl(other.source, other.videoId, other.url)} muted playsInline preload="metadata"
              onClick={playPause}
              onLoadedMetadata={(e) => setSlaveDur(e.currentTarget.duration)} />}
          </div>
        )}
        </div>
  );
  const approvalView = !admin && (() => { const mine = approval && name.trim() && approval.by === name.trim(); return (
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
        ); })();
  const filtersView = (
        <div className="filters">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="seg-ctl sm">
              {[['all', 'Tous'], ['open', 'À traiter'], ['done', 'Résolus']].map(([k, l]) => (
                <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
              ))}
            </div>
<button className={onlyMarked ? 'ghost sm on' : 'ghost sm'} onClick={() => setOnlyMarked((v) => !v)} title="Seulement les dessins et repères">Dessins</button>
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
  );
  const ZONE_GAP = 5;
  const zones = [];
  for (const c of [...shown].sort((a, b) => a.t - b.t)) {
    const z = zones[zones.length - 1];
    if (z && c.t - z.end <= ZONE_GAP) { z.items.push(c); z.end = Math.max(z.end, c.t_end ?? c.t); }
    else zones.push({ start: c.t, end: c.t_end ?? c.t, items: [c] });
  }
  const kindOf = (c) => (c.body === 'Repère' && !hasMarks(c) ? 'marker' : hasMarks(c) ? 'drawing' : 'comment');
  const zoneSummary = (items) => {
    const n = { drawing: 0, marker: 0, comment: 0 };
    items.forEach((c) => n[kindOf(c)]++);
    return [n.drawing && `${n.drawing} dessin${n.drawing > 1 ? 's' : ''}`, n.marker && `${n.marker} repère${n.marker > 1 ? 's' : ''}`, n.comment && `${n.comment} commentaire${n.comment > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
  };
  const preview = (c) => (
    <span className="cm-preview" style={{ aspectRatio: ratio }}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none">{(c.shapes || []).map((sh, i) => <Shape key={i} s={sh} box={{ w: 64 * ratio, h: 64 }} />)}</svg>
      {c.x != null && <i style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }} />}
    </span>
  );
  const commentList = (
        <div className="list">
          {zones.map((z) => (
            <section key={z.items[0].id} className={`zone ${z.items.length > 1 ? 'multi' : ''}`}>
              {z.items.length > 1 && (
                <header className="zone-head">
                  <button className="link zone-time" onClick={() => { setSel(z.items[0].id); seekT(z.start); }}>Zone {label(z.start)} → {label(z.end)}</button>
                  <span className="mut">{zoneSummary(z.items)}</span>
                  <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                    {z.items.some((c) => !c.resolved) && <button className="ghost sm" onClick={() => resolveAll(z.items)}>✓ Tout valider</button>}
                    {admin && <button className="ghost sm" onClick={() => deleteAll(z.items)}>Tout supprimer</button>}
                  </span>
                </header>
              )}
          {z.items.map((c) => (
            <div key={c.id} data-comment-id={c.id} className={`cm ${c.resolved ? 'done' : ''} ${sel === c.id ? 'sel' : ''}`}
              onClick={() => { setSel(c.id); seekT(c.t); if (mobile) setSheet(null); }}>
              <div className="cm-head">
                <span>
                  <span className="num">{numberOf[c.id]}</span><span className="tc">{rangeLabel(c)}</span> · <strong>{c.author}</strong>
                  <span className="when" title={new Date(c.created_at).toLocaleString('fr-BE')}>{fmtWhen(c.created_at)}</span>
                  {kindOf(c) === 'marker' && <span className="tag tag-marker">repère</span>}
                  {kindOf(c) === 'drawing' && <span className="tag">dessin</span>}
                </span>
                <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {pro && <button className="ghost sm" title="Copier le lien vers ce commentaire" onClick={() => copyLink(c)}>Lien</button>}
                  <button className="ghost sm" onClick={() => toggle(c)}>{c.resolved ? 'Rouvrir' : '✓ Résolu'}</button>
                  {admin && <button className="ghost sm" aria-label="Supprimer" onClick={() => del(c)}>✕</button>}
                </span>
              </div>
              <div className="cm-body">
                {kindOf(c) === 'drawing' && preview(c)}
                {kindOf(c) !== 'marker' && <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>}
              </div>
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
            </section>
          ))}
          {!shown.length && <p className="mut">{tops.length ? 'Aucun résultat.' : 'Aucun commentaire.'}</p>}
        </div>
  );
  const composeView = (
        <div className="compose">
          {askName
            ? <div style={{ display: 'grid', gap: 6 }}>
                {needName && <span className="mut">Indique ton prénom pour valider cette version, puis clique à nouveau.</span>}
                <input placeholder="Ton prénom" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            : <div className="compose-who mut">Tu commentes en tant que&nbsp;<strong style={{ color: 'var(--txt)' }}>{name}</strong>&nbsp;·&nbsp;<button className="link" style={{ padding: 0 }} onClick={() => setEditName(true)}>changer</button></div>}
          {pro && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="ghost sm" onClick={() => { vid.current.pause(); setStampF(curF); if (endF != null && endF <= curF) setEndF(null); }}>In {label(stampF / F)}</button>
              <button className="ghost sm" onClick={() => { vid.current.pause(); if (curF > stampF) setEndF(curF); }}>Out {endF != null ? label(endF / F) : '—'}</button>
              {endF != null && <button className="link" style={{ padding: 0 }} onClick={() => setEndF(null)}>retirer la plage</button>}
            </div>
          )}
          {!pro && endF != null && (
            <div className="zone-line mut">Zone {draftLabel} · <button className="link" style={{ padding: 0 }} onClick={() => setEndF(null)}>retirer la zone</button></div>
          )}
          <textarea ref={noteRef} rows={3} placeholder={endF != null ? `Ta note sur ${draftLabel}…` : `Ton commentaire à ${draftLabel}…`} value={body}
            onFocus={beginCompose} onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }} />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="mut">{drawing ? `${shapes.length + (pin ? 1 : 0)} dessin(s) joint(s)` : '⌘ + Entrée pour envoyer'}</span>
            <button onClick={send} disabled={!body.trim() || !name.trim()}>Envoyer</button>
          </div>
        </div>
  );

  // --- mobile : tiroir des commentaires ---
  const closeVerdict = useRef(null); closeVerdict.current = () => { if (sheet === 'verdict') setSheet(null); };
  useEffect(() => { if (approval) closeVerdict.current(); }, [approval]);
  const openSheet = (mode) => { vid.current?.pause(); setSheet(mode); if (mode === 'compose') setTimeout(() => noteRef.current?.focus(), 260); };

  if (mobile) {
    const shortStatus = approval ? (approval.status === 'approved' ? 'Validée' : 'Modifications demandées') : admin ? 'En attente de l’avis du client' : null;
    const verdict = approval ? (approval.status === 'approved' ? '✓ Validée' : 'Modifs') : 'Valider';
    const pending = shapes.length + (pin ? 1 : 0);
    return (
      <div className="review mobile">
        <header className="m-top">
          <Brand className="m-brand" />
          {back && <Link className="m-back" to={back.to} title={`Retour : ${back.label}`}>← {back.label}</Link>}
          <div className="m-title">
            <b>{title}</b>
            {versions.length > 1 ? (
              <select className="m-version" value={currentN} onChange={(e) => goVersion(Number(e.target.value))} aria-label="Version">
                {versions.map((x) => <option key={x.n} value={x.n}>v{x.n}{x.status === 'approved' ? ' ✓' : ''}</option>)}
              </select>
            ) : <span className="m-v">v{currentN}</span>}
            {admin && <i className={`m-dot ${approval?.status || ''}`} title={shortStatus} aria-label={shortStatus} />}
          </div>
          {!admin && <button className={`m-next ${approval?.status || ''}`} onClick={() => openSheet('verdict')}>{verdict}</button>}
        </header>
        {currentN !== latestN && <button className="m-banner" onClick={() => goVersion(latestN)}>Version récente : v{latestN} · voir</button>}
        {monitorView}
        {toolsOpen && tool !== 'pin' && (
          <div className="m-drawbar"><DrawingToolbar tool={tool} onTool={pickTool} color={color} onColor={setColor} only={['pen', 'arrow', 'circle', 'rect']} /></div>
        )}
        {captureMessage && <div className="notes" role="status">{captureMessage}</div>}
        <div className="m-ctrl">
          <button className="m-ic" onClick={toggleMute} aria-label={muted ? 'Remettre le son' : 'Couper le son'}><MIcon d={muted ? M_ICONS.mute : M_ICONS.sound} /></button>
          <button className="m-ic m-playbtn" onClick={playPause} aria-label={playing ? 'Pause' : 'Lecture'}><MIcon d={playing ? M_ICONS.pause : M_ICONS.play} /></button>
          <span className="m-undo">
            <button className="m-ic" onClick={undoDraw} disabled={!pending} aria-label="Annuler le dernier dessin"><MIcon d={M_ICONS.undo} /></button>
            <button className="m-ic" onClick={redoDraw} disabled={!redoStack.length} aria-label="Refaire le dessin"><MIcon d={M_ICONS.redo} /></button>
          </span>
        </div>
        <MobileTrack dur={dur} now={now} F={F} peaks={peaks} flatPeaks={flatPeaks} waveStyle={waveStyle} waveTint={waveTint} waveLow={waveLow}
          clock={<><b>{tcSimple(now)}<small>:{pad(curF % base)}</small></b>/{tcSimple(dur || 0)}</>}
          tops={tops} numberOf={numberOf} sel={sel} onScrub={(f) => scrubTo(f)} onScrubEnd={flushScrub}
          onPick={(c) => { setSel(c.id); seekT(c.t); }} onAdd={() => openSheet('compose')} pending={pending} />
        <nav className="m-tools" aria-label="Outils">
          <button aria-label="Dessiner" title="Dessiner" className={toolsOpen && tool !== 'pin' ? 'on' : ''} onClick={() => { if (toolsOpen && tool !== 'pin') { setToolsOpen(false); setTool(null); } else { vid.current?.pause(); setToolsOpen(true); setTool(tool && tool !== 'pin' ? tool : 'pen'); } }}><MIcon d={M_ICONS.pen} /></button>
          <button aria-label="Poser un repère sur la timeline" title="Repère" className={marking ? 'on' : ''} onClick={addMarker} disabled={marking}><MIcon d={M_ICONS.marker} /></button>
          <button className="m-history" aria-label="Commentaires" title="Commentaires" onClick={() => openSheet('list')}>
            <MIcon d={M_ICONS.chat} />{tops.length ? <b>{tops.length}</b> : null}
          </button>
          {dlUrl
            ? <a className="m-dl" href={dlUrl} target="_blank" rel="noopener noreferrer" aria-label="Télécharger le fichier" title="Télécharger"><MIcon d={M_ICONS.download} /></a>
            : admin && <button aria-label="Ajouter un lien de téléchargement" title="Lien de téléchargement" onClick={editDownload}><MIcon d={M_ICONS.download} /></button>}
          {!(isYt || source === 'drive') && <button aria-label="Capture" title="Capture" onClick={capture} disabled={capturing}><MIcon d={M_ICONS.camera} /></button>}
        </nav>
        {sheet && <div className="m-veil" onClick={() => setSheet(null)} />}
        <section className={`m-sheet ${sheet ? `open ${sheet}` : ''}`} aria-hidden={!sheet}>
          <button className="m-handle" aria-label="Fermer" onClick={() => setSheet(null)}><i /></button>
          {sheet === 'verdict' ? <div className="m-verdict">
            {approvalView}
            {askName && <input placeholder="Ton prénom (pour signer ton avis)" value={name} onChange={(e) => setName(e.target.value)} />}
          </div> : <>
            <div className="m-sheet-head"><h2>Commentaires</h2><CommentNavigation comments={shown} currentId={sel} position={curF / F} onSelect={(c) => { setSel(c.id); seekT(c.t); setSheet(null); }} /></div>
            {sheet === 'list' && filtersView}
            {sheet === 'list' && commentList}
            {composeView}
          </>}
        </section>
      </div>
    );
  }

  return (
    <div className={`review ${expanded ? 'review-expanded' : ''}`}>
      <div className="stage">
        <header className="topbar">
          <div>
            <div className="review-nav"><Brand />{back && <BackButton to={back.to} label={back.label} />}</div>
            <div className="review-context">{back
              ? <span className="eyebrow">Projet · {back.label}</span>
              : <div className="eyebrow">Review{isYt ? ' · YouTube' : ''}</div>}{deadline}</div>
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
            {downloadBtn}
            {admin && <button className="ghost sm" onClick={editDownload} title="Lien Drive que le client ouvre avec « Télécharger »">{dlUrl ? 'Lien de téléchargement' : '+ Lien de téléchargement'}</button>}
            <button className="ghost sm" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)} title={expanded ? 'Revenir à la vue avec commentaires · Échap' : 'Agrandir le lecteur et masquer les commentaires'}>{expanded ? 'Réduire' : 'Agrandir'}</button>
            {cmpable.length > 0 && <button className={compareN ? 'ghost on' : 'ghost'} onClick={toggleCompare} title="Voir deux versions côte à côte, lecture synchronisée">Comparer</button>}
            {versions.length > 1 && (
              <div className="seg-ctl" role="group" aria-label="Version">
                {versions.map((x) => (
                  <button key={x.n} className={x.n === currentN ? 'on' : ''} onClick={() => x.n !== currentN && goVersion(x.n)}
                    title={x.status === 'approved' ? 'Version validée' : x.status === 'changes' ? 'Modifications demandées' : ''}>
                    v{x.n}{x.status === 'approved' ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            )}
            <div className="seg-ctl" role="group" aria-label="Mode d’affichage">
              <button className={pro ? '' : 'on'} onClick={() => pro && togglePro()}>Simple</button>
              <button className={pro ? 'on' : ''} onClick={() => !pro && togglePro()} title="Timecode à l’image, zoom, plage In/Out, réglages de l’onde">Pro</button>
            </div>
          </div>
        </header>

        {currentN !== latestN && !compareN && (
          <div className="banner">
            <span>Tu regardes la v{currentN}. La version la plus récente est la v{latestN}.</span>
            <button className="ghost sm" onClick={() => goVersion(latestN)}>Voir la v{latestN}</button>
          </div>
        )}
        {approvalView}

        {compareN && (
          <div className="cmp-bar">
            <span className="mut">Comparer la v{currentN} avec</span>
            <div className="seg-ctl sm">
              {cmpable.map((x) => (
                <button key={x.n} className={x.n === compareN ? 'on' : ''} onClick={() => setCmp(x.n)}>v{x.n}</button>
              ))}
            </div>
            <div className="spacer" />
            <span className="mut">Son</span>
            <div className="seg-ctl sm">
              <button className={soundFrom === 'a' ? 'on' : ''} onClick={() => setSoundFrom('a')}>v{currentN}</button>
              <button className={soundFrom === 'b' ? 'on' : ''} onClick={() => setSoundFrom('b')}>v{compareN}</button>
            </div>
            <button className="ghost sm" onClick={() => setCmp(null)}>Fermer</button>
          </div>
        )}

        {monitorView}

        {captureMessage && <div className="notes" role="status">{captureMessage}</div>}
        <div className={`track ${pro ? 'pro' : ''} ${selecting ? 'selecting' : ''}`} ref={track}
          onPointerDown={onTrackDown} onPointerMove={onTrackMove} onPointerUp={onTrackUp} onPointerCancel={onTrackUp}
          onPointerLeave={() => setHover(null)}>
          {dur > 0 && <Wave peaks={peaks || flatPeaks} muted={!peaks} dur={dur} vs={vs} span={span} variant={waveStyle} tint={waveTint} low={waveLow} />}
          {pro && ticks.out.map((t) => (
            <div key={t} className="tick" style={{ left: xp(t) }}><span>{tickLabel(t)}</span></div>
          ))}
          {dur > 0 && tops.map((c) => (
            <Marker key={c.id} c={c} n={numberOf[c.id]} sel={sel === c.id} left={xp(c.t)} width={c.t_end ? `${((c.t_end - c.t) / span) * 100}%` : null}
              title={`${rangeLabel(c)} — ${c.author} : ${c.body}`}
              onDown={(e) => { if (e.shiftKey) return; e.stopPropagation(); setSel(c.id); seekT(c.t); }} />
          ))}
          {dur > 0 && endF != null && <div className="selzone" style={{ left: xp(stampF / F), width: `${(((endF - stampF) / F) / span) * 100}%` }} />}
          <div className="head" style={{ left: xp(now) }} />
          {hover && <div className="hov" style={{ left: hover.x }}><span>{label(hover.t)}</span></div>}
        </div>

        <div className="transport">
          <div className="timecode"><span className="cur">{label(now)}</span><span className="tot">/ {label(dur || 0)}</span></div>
          <button className="ghost sm" onClick={addMarker} disabled={marking || !dur} title="Poser un repère à l’image affichée · touche M">Repère</button>
          <div className="spacer" />
          {pro && <span className="meta">{F} images/s</span>}
        </div>

        {pro && (
          <div className="dock pro-controls">
            <div className="pro-navigation">
            <div className="dock-group">
              <label>Déplacement ← →</label>
              <div className="seg-ctl sm">
                <button className={stepMode === 'frame' ? 'on' : ''} onClick={() => setStepTo('frame')}>1 image</button>
                <button className={stepMode === 'second' ? 'on' : ''} onClick={() => setStepTo('second')}>1 seconde</button>
              </div>
            </div>
            <div className="dock-group">
              <label>Zoom timeline</label>
              <div className="seg-ctl sm">
                <button onClick={() => zoomBy(1.6)} aria-label="Dézoomer">−</button>
                <button onClick={() => zoomBy(1 / 1.6)} aria-label="Zoomer">+</button>
                <button onClick={() => setView({ s: 0, span: dur })}>Tout</button>
              </div>
            </div>
            </div>
            <details className="pro-settings">
              <summary>Onde sonore</summary>
              <div className="pro-wave-options">
                <div className="dock-group">
                  <label>Style</label>
                  <div className="seg-ctl sm">
                    {WAVE_STYLES.map(([k, l]) => <button key={k} className={waveStyle === k ? 'on' : ''} onClick={() => savePref('review-wave', k, setWaveStyle)}>{l}</button>)}
                  </div>
                </div>
                <div className="dock-group">
                  <label>Position</label>
                  <div className="seg-ctl sm">
                    <button className={!waveLow ? 'on' : ''} onClick={() => savePref('review-wavelow', '0', () => setWaveLow(false))}>Centrée</button>
                    <button className={waveLow ? 'on' : ''} onClick={() => savePref('review-wavelow', '1', () => setWaveLow(true))}>En bas</button>
                  </div>
                </div>
                <div className="dock-group">
                  <label>Teinte</label>
                  <div className="seg-ctl sm">
                    <button className={waveTint === 'vol' ? 'on' : ''} onClick={() => savePref('review-wavetint', 'vol', setWaveTint)}>Volume</button>
                    <button className={waveTint === 'flat' ? 'on' : ''} onClick={() => savePref('review-wavetint', 'flat', setWaveTint)}>Unie</button>
                  </div>
                </div>
              </div>
            </details>
            <details className="pro-settings pro-shortcuts">
              <summary>Raccourcis</summary>
              <dl>
                <div><dt>Maj + clic</dt><dd>Étendre depuis la tête</dd></div>
                <div><dt>Maj + glisser</dt><dd>Sélectionner une zone</dd></div>
                <div><dt>Maj + ← / →</dt><dd>Changer de pas</dd></div>
                <div><dt>M</dt><dd>Poser un repère</dd></div>
                <div><dt>Molette</dt><dd>Zoomer</dd></div>
                <div><dt>Espace</dt><dd>Lecture / pause</dd></div>
                <div><dt>Alt + ↑ / ↓</dt><dd>Parcourir les commentaires</dd></div>
              </dl>
            </details>
          </div>
        )}

        {((pro && isYt) || waving || peaksError || (admin && !peaks && (isYt || needLocalWave)) || (admin && fileSize > 1.5e9)) && (
          <div className="notes">
            {isYt && pro && <span>Vidéo YouTube : précision à l’image non garantie{peaks ? '' : ', pas d’onde sonore'}.{admin ? ' Règle les images/s dans « Avancé » du tableau de bord.' : ''}</span>}
            {admin && fileSize > 1.5e9 && (
              <span>Fichier de {(fileSize / 1e9).toFixed(1).replace('.', ',')} Go : depuis Drive, la lecture et les sauts dans la timeline peuvent être lents, et Google bloque parfois temporairement. Pour les retours, partage plutôt une version allégée (1080p).</span>
            )}
            {admin && !peaks && !waving && (isYt || needLocalWave) && (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="ghost sm" onClick={(e) => e.currentTarget.nextSibling.click()}>Ajouter l’onde sonore</button>
                <input type="file" accept="video/*,audio/*" hidden onChange={peaksFromFile} />
                <span>Choisis le fichier vidéo sur ton ordinateur : seul le son est lu, rien n’est envoyé.</span>
              </div>
            )}
            {waving && <span>Création de l’onde sonore… {waveMsg}</span>}
            {peaksError && (
              <span style={{ color: 'var(--gold)' }}>
                L’onde n’a pas pu être enregistrée : elle disparaîtra au rechargement.{' '}
                <button className="link" onClick={() => peaks && savePeaks(peaks)}>Réessayer</button>
              </span>
            )}
          </div>
        )}
      </div>

      <aside className="side">
        <div className="side-head">
          <h2>Commentaires</h2>
          <CommentNavigation comments={shown} currentId={sel} position={curF / F} onSelect={(c) => { setSel(c.id); seekT(c.t); }} />
        </div>
        {filtersView}

        {commentList}

        {composeView}
      </aside>
    </div>
  );
}
