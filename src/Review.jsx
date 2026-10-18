import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as data from './data';
import { videoUrl, driveMeta } from './links';
import { peaksFromLocalMp4, peaksFromBuffer, encodePeaks, b64ToBytes } from './audioPeaks';
import { COLORS, TOOLS, clamp, parse, hasMarks, Shape, toShape, IconPlay, IconPause, IconChevron } from './draw';

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
const WAVE_STYLES = [['bars', 'Barres'], ['solid', 'Plein'], ['line', 'Ligne'], ['low', 'Bas']];

// onde sonore : suit exactement la vue (zoom/défilement) de la timeline
// `stereo` affiche deux voies (gauche en haut, droite en bas), sinon les deux canaux sont fusionnés
function Wave({ peaks, dur, vs, span, top, variant, tint, stereo, muted }) {
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
      if (variant === 'bars' || variant === 'low') {
        for (let x = 0; x < w; x += 4) {
          const v = col(x, x + 4);
          if (v == null) continue;
          const hh = Math.max(2, v * hl * 0.92);
          g.fillStyle = color(v);
          g.fillRect(x, variant === 'low' ? y0 + hl - hh : y0 + (hl - hh) / 2, 3, hh);
        }
      } else if (variant === 'solid') {
        for (let x = 0; x < w; x++) {
          const v = col(x, x + 1);
          if (v == null) continue;
          const hh = Math.max(1, v * hl);
          g.fillStyle = color(v);
          g.fillRect(x, y0 + (hl - hh) / 2, 1, hh);
        }
      } else { // line : enveloppe fine, haut et bas
        g.lineWidth = 1.5; g.lineCap = 'round';
        let prev = null;
        const mid = y0 + hl / 2;
        for (let x = 0; x < w; x += 2) {
          const v = col(x, x + 2);
          if (v == null) { prev = null; continue; }
          const y = (v * hl * 0.92) / 2;
          if (prev != null) {
            g.strokeStyle = color(v);
            g.beginPath(); g.moveTo(x - 2, mid - prev); g.lineTo(x, mid - y); g.stroke();
            g.beginPath(); g.moveTo(x - 2, mid + prev); g.lineTo(x, mid + y); g.stroke();
          }
          prev = y;
        }
      }
    };

    if (stereo && peaks.r) {
      const gap = 3, hl = (h - gap) / 2;
      lane(peaks.l, 0, hl);
      lane(peaks.r, hl + gap, hl);
      g.fillStyle = 'rgba(255,255,255,.08)';
      g.fillRect(0, hl + gap / 2 - 0.5, w, 1);
    } else lane(merged, 0, h);
  }, [peaks, merged, dur, vs, span, size, variant, tint, stereo, muted]);
  return <canvas ref={ref} className="wave" style={{ top, height: `calc(100% - ${top}px)` }} />;
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

export default function Review({ aid, title, admin, back = null, initialFps, initialPeaks, source, videoId, mediaUrl = null, fileBytes = null, versions = [], currentN = 1, latestN = 1, initialStatus = null, initialCompare = null }) {
  const isYt = source === 'youtube';
  const navigate = useNavigate();
  const [approval, setApproval] = useState(initialStatus);
  const [needName, setNeedName] = useState(false);
  const [ratio, setRatio] = useState(16 / 9);  // ratio réel de la vidéo (16:9 par défaut)
  const [fit, setFit] = useState(null);         // taille du cadre vidéo : le plus grand rectangle de ce ratio qui tient
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
  const [waveChannels, setWaveChannels] = useState('mono'); // 'mono' (fusionné) | 'stereo' (2 voies)
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
  const [draft, setDraft] = useState(null);

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
      const ws = localStorage.getItem('review-wave'); if (WAVE_STYLES.some(([k]) => k === ws)) setWaveStyle(ws);
      if (localStorage.getItem('review-wavetint') === 'flat') setWaveTint('flat');
      if (localStorage.getItem('review-wavech') === 'stereo') setWaveChannels('stereo');
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
    const r = v.videoWidth / v.videoHeight;
    if (r > 0.2 && r < 6) setRatio((cur) => (Math.abs(cur - r) < 0.001 ? cur : r));
  }, []);
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
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      const mobile = window.innerWidth <= 900, gap = 12;
      const cols = compareN && !mobile ? 2 : 1;
      const bw = (w - gap * (cols - 1)) / cols;
      const pw = Math.min(bw, mobile ? Infinity : h * ratio);
      const nw = Math.floor(pw), nh = Math.floor(pw / ratio);
      setFit((f) => (f && f.w === nw && f.h === nh ? f : { w: nw, h: nh }));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    window.addEventListener('resize', calc);
    return () => { ro.disconnect(); window.removeEventListener('resize', calc); };
  }, [compareN, ratio]);

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
  const stepF = useCallback((d) => seekF((scrub.current.pending ?? Math.floor(vid.current.currentTime * Ff.current + 1e-4)) + d), [seekF]);
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
  }, []);
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

  const resetDraft = () => { setBody(''); setEndF(null); setTool(null); setToolsOpen(false); setPin(null); setShapes([]); setDraft(null); };

  const post = (payload) => data.addComment(aid, currentN, { author: name, ...payload });
  const remember = () => { try { localStorage.setItem('review-name', name); } catch {} setNameOk(true); setEditName(false); };

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
      else if (e.key === 'Escape') { setTool(null); }
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
    if (onlyMarked && !hasMarks(c)) return false;
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

  const askName = !nameOk || editName;
  const draftLabel = endF != null ? `${label(stampF / F)} → ${label(endF / F)}` : label(stampF / F);

  const stereoOn = waveChannels === 'stereo' && !!peaks?.r;
  const flatPeaks = useMemo(() => ({ l: new Uint8Array(400).fill(16), r: null }), []); // onde plate de remplacement

  return (
    <div className="review">
      <div className="stage">
        <header className="topbar">
          <div>
            {back
              ? <Link className="eyebrow back" to={back.to}>← {back.label}</Link>
              : <div className="eyebrow">Review{isYt ? ' · YouTube' : ''}</div>}
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
        {!admin && (() => { const mine = approval && name.trim() && approval.by === name.trim(); return (
          <div className="approval">
            <div>
              {approval
                ? <><span className={`state ${approval.status}`}>{mine
                    ? (approval.status === 'approved' ? 'Tu as validé cette version' : 'Tu as demandé des modifications')
                    : `${approval.by} ${approval.status === 'approved' ? 'a validé cette version' : 'a demandé des modifications'}`}</span><span className="mut"> · {fmtDay(approval.at)}</span></>
                : <span>Cette version te convient ? <span className="mut">Une fois tes commentaires laissés, donne ton avis.</span></span>}
            </div>
            <div className="row">
              {approval && <button className="link" onClick={() => setReview(null)}>{mine ? 'Changer d’avis' : 'Retirer l’avis'}</button>}
              <button className={approval?.status === 'changes' ? 'ghost sm on' : 'ghost sm'} onClick={() => setReview('changes')}>Demander des modifications</button>
              <button className={approval?.status === 'approved' ? 'ok sm' : 'sm'} onClick={() => setReview('approved')}>{approval?.status === 'approved' ? '✓ Validée' : 'Valider cette version'}</button>
            </div>
          </div>
        ); })()}

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

        <div className={`vstage ${compareN ? 'two' : ''}`} ref={vstage}>
        <div className="vwrap" ref={wrap} style={fit ? { width: fit.w, height: fit.h } : undefined}>
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
        </div>
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

        <div className={`track ${pro ? 'pro' : ''}`} ref={track}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrubTo(Math.floor(timeAt(e) * F), true); }}
          onPointerMove={(e) => { setHover({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, t: timeAt(e) }); if (e.buttons === 1) scrubTo(Math.floor(timeAt(e) * F)); }}
          onPointerUp={flushScrub}
          onPointerLeave={() => setHover(null)}>
          {dur > 0 && <Wave peaks={peaks || flatPeaks} muted={!peaks} dur={dur} vs={vs} span={span} top={pro ? 16 : 0} variant={waveStyle} tint={waveTint} stereo={stereoOn} />}
          {stereoOn && <><span className="lane-tag" style={{ top: pro ? 20 : 5 }}>G</span><span className="lane-tag" style={{ bottom: 5 }}>D</span></>}
          {pro && ticks.out.map((t) => (
            <div key={t} className="tick" style={{ left: xp(t) }}><span>{tickLabel(t)}</span></div>
          ))}
          {dur > 0 && tops.map((c) => c.t_end
            ? <div key={c.id} className={`seg ${c.resolved ? 'done' : ''}`} style={{ left: xp(c.t), width: `${((c.t_end - c.t) / span) * 100}%` }}
                onPointerDown={(e) => { e.stopPropagation(); setSel(c.id); seekT(c.t); }} />
            : <div key={c.id} className={`mk ${c.resolved ? 'done' : ''}`} style={{ left: xp(c.t) }} title={`${label(c.t)} — ${c.author}`}
                onPointerDown={(e) => { e.stopPropagation(); setSel(c.id); seekT(c.t); }} />)}
          {dur > 0 && endF != null && <div className="seg draft" style={{ left: xp(stampF / F), width: `${(((endF - stampF) / F) / span) * 100}%` }} />}
          <div className="head" style={{ left: xp(now) }} />
          {hover && <div className="hov" style={{ left: hover.x }}><span>{label(hover.t)}</span></div>}
        </div>

        <div className="transport">
          <button className="play" onClick={playPause} aria-label={playing ? 'Pause' : 'Lecture'}>{playing ? <IconPause /> : <IconPlay />}</button>
          {pro && <button className="ghost icon" title="Reculer (←)" aria-label="Reculer" onClick={() => stepBy(-1)}><IconChevron dir="left" /></button>}
          {pro && <button className="ghost icon" title="Avancer (→)" aria-label="Avancer" onClick={() => stepBy(1)}><IconChevron dir="right" /></button>}
          <div className="timecode"><span className="cur">{label(now)}</span><span className="tot">/ {label(dur || 0)}</span></div>
          <div className="spacer" />
          {pro && <span className="meta">{F} images/s</span>}
          <button className={toolsOpen ? 'ghost on' : 'ghost'} onClick={toggleTools}>Dessiner</button>
        </div>

        {toolsOpen && (
          <div className="tools">
            <div className="seg-ctl">
              {TOOLS.map(([k, l]) => <button key={k} className={tool === k ? 'on' : ''} onClick={() => pickTool(k)}>{l}</button>)}
            </div>
            <span className="sw">
              {COLORS.map((c) => <i key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} />)}
            </span>
            <button className="ghost sm" disabled={!shapes.length && !pin} onClick={() => (shapes.length ? setShapes((s) => s.slice(0, -1)) : setPin(null))}>Annuler</button>
          </div>
        )}

        {pro && (
          <div className="dock">
            <div className="dock-group">
              <label>Pas des flèches</label>
              <div className="seg-ctl sm">
                <button className={stepMode === 'frame' ? 'on' : ''} onClick={() => setStepTo('frame')}>1 image</button>
                <button className={stepMode === 'second' ? 'on' : ''} onClick={() => setStepTo('second')}>1 seconde</button>
              </div>
            </div>
            <div className="dock-group">
              <label>Zoom</label>
              <div className="seg-ctl sm">
                <button onClick={() => zoomBy(1.6)} aria-label="Dézoomer">−</button>
                <button onClick={() => zoomBy(1 / 1.6)} aria-label="Zoomer">+</button>
                <button onClick={() => setView({ s: 0, span: dur })}>Tout</button>
              </div>
            </div>
            <div className="dock-group">
              <label>Raccourcis</label>
              <span className="mut" style={{ fontSize: 12, lineHeight: '24px' }}>← → pas · Maj + flèche : l’autre pas · S : changer · molette : zoom</span>
            </div>
            {peaks && (
              <>
                <div className="dock-group">
                  <label>Type d’onde</label>
                  <div className="seg-ctl sm">
                    {WAVE_STYLES.map(([k, l]) => <button key={k} className={waveStyle === k ? 'on' : ''} onClick={() => savePref('review-wave', k, setWaveStyle)}>{l}</button>)}
                  </div>
                </div>
                <div className="dock-group">
                  <label>Canaux</label>
                  <div className="seg-ctl sm">
                    <button className={waveChannels === 'mono' ? 'on' : ''} onClick={() => savePref('review-wavech', 'mono', setWaveChannels)}>Mono</button>
                    <button className={waveChannels === 'stereo' ? 'on' : ''} disabled={!peaks.r} title={peaks.r ? '' : 'Cette vidéo est en mono'} onClick={() => savePref('review-wavech', 'stereo', setWaveChannels)}>Stéréo</button>
                  </div>
                </div>
                <div className="dock-group">
                  <label>Teinte</label>
                  <div className="seg-ctl sm">
                    <button className={waveTint === 'vol' ? 'on' : ''} onClick={() => savePref('review-wavetint', 'vol', setWaveTint)}>Selon le volume</button>
                    <button className={waveTint === 'flat' ? 'on' : ''} onClick={() => savePref('review-wavetint', 'flat', setWaveTint)}>Unie</button>
                  </div>
                </div>
              </>
            )}
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
          <span className="count">{tops.length}</span>
        </div>
        <div className="filters">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="seg-ctl sm">
              {[['all', 'Tous'], ['open', 'À traiter'], ['done', 'Résolus']].map(([k, l]) => (
                <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
              ))}
            </div>
            {pro && <button className={onlyMarked ? 'ghost sm on' : 'ghost sm'} onClick={() => setOnlyMarked((v) => !v)}>Dessinés</button>}
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
            <div key={c.id} className={`cm ${c.resolved ? 'done' : ''} ${sel === c.id ? 'sel' : ''}`}
              onClick={() => { setSel(c.id); seekT(c.t); }}>
              <div className="cm-head">
                <span>
                  <span className="num">{numberOf[c.id]}</span><span className="tc">{rangeLabel(c)}</span> · <strong>{c.author}</strong>
                  <span className="when" title={new Date(c.created_at).toLocaleString('fr-BE')}>{fmtWhen(c.created_at)}</span>
                  {hasMarks(c) && <span className="tag">dessin</span>}
                </span>
                <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {pro && <button className="ghost sm" title="Copier le lien vers ce commentaire" onClick={() => copyLink(c)}>Lien</button>}
                  <button className="ghost sm" onClick={() => toggle(c)}>{c.resolved ? 'Rouvrir' : '✓ Résolu'}</button>
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
          {!shown.length && <p className="mut">{tops.length ? 'Rien dans ce filtre.' : 'Aucun commentaire pour l’instant. Écris le premier ci-dessous.'}</p>}
        </div>

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
          <textarea rows={3} placeholder={`Ton commentaire à ${draftLabel}…`} value={body}
            onFocus={beginCompose} onChange={(e) => setBody(e.target.value)}
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
