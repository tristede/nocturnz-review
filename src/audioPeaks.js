// Onde sonore d'un fichier vidéo LOCAL, même très lourd (plusieurs Go), sans charger la vidéo :
//  1. mp4box lit seulement l'index du fichier (boîte « moov ») en sautant les données vidéo ;
//  2. on lit uniquement les octets de la piste son (quelques dizaines de Mo pour 40 min) ;
//  3. WebCodecs décode le son ; on garde le maximum par tranche de temps.
// Le fichier ne quitte jamais l'ordinateur : seul le tracé (≈ 20 Ko) est enregistré.
import { createFile, MP4BoxBuffer } from 'mp4box';

export const bucketsFor = (dur) => Math.min(10000, Math.max(200, Math.round(dur * 200)));

// même échelle pour les deux canaux, courbe adoucie (les passages calmes restent visibles)
// max : pic absolu du fichier (amplitude 0..1), pour retrouver le vrai niveau en dB (indicateur de niveau)
export const PEAK_CURVE = 0.6;
export function toPeaks(raw) {
  let max = 0;
  for (const ch of raw) for (let i = 0; i < ch.length; i++) if (ch[i] > max) max = ch[i];
  max = max || 1;
  const to8 = (o) => Uint8Array.from(o, (v) => Math.round(255 * Math.pow(v / max, PEAK_CURVE)));
  return { l: to8(raw[0]), r: raw[1] ? to8(raw[1]) : null, max };
}

async function readIndex(file) {
  const mp4 = createFile();
  let info = null, failed = null;
  mp4.onReady = (i) => { info = i; };
  mp4.onError = (_m, msg) => { failed = msg; };
  const CH = 1 << 20; // 1 Mo à la fois ; mp4box indique où lire ensuite (il saute les données vidéo)
  let pos = 0, guard = 0;
  while (!info && !failed && pos < file.size && guard++ < 20000) {
    const end = Math.min(file.size, pos + CH);
    const ab = await file.slice(pos, end).arrayBuffer();
    const next = mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos), end >= file.size);
    pos = next > pos ? next : end;
  }
  if (!info) throw new Error(failed || 'index du fichier introuvable');
  return { mp4, info };
}

// AudioSpecificConfig (AAC) : nécessaire au décodeur WebCodecs
const aacConfig = (entry) => entry?.esds?.esd?.descs?.[0]?.descs?.[0]?.data;

/**
 * @param {File} file   fichier MP4/MOV choisi par l'hôte
 * @param {number} dur  durée de la vidéo lue dans l'outil (pour caler l'onde sur la même timeline)
 * @param {(p:number)=>void} [onProgress]  avancement 0..1
 */
export async function peaksFromLocalMp4(file, dur, onProgress) {
  if (typeof AudioDecoder === 'undefined') throw new Error('Ce navigateur ne sait pas décoder le son (essaie Chrome).');
  const { mp4, info } = await readIndex(file);
  const track = info.audioTracks?.[0];
  if (!track) throw new Error('Ce fichier n’a pas de piste son.');
  const trak = mp4.getTrackById(track.id);
  const samples = trak.samples || [];
  if (!samples.length) throw new Error('Piste son vide (fichier fragmenté ?).');

  const config = {
    codec: track.codec,
    sampleRate: track.audio.sample_rate,
    numberOfChannels: track.audio.channel_count,
  };
  const desc = aacConfig(samples[0].description);
  if (desc) config.description = desc;
  const { supported } = await AudioDecoder.isConfigSupported(config);
  if (!supported) throw new Error(`Format audio non pris en charge (${track.codec}).`);

  // Décalage de début : le lecteur vidéo retire l'amorçage de l'encodeur (liste d'édition du fichier, ou
  // 2112 échantillons pour l'AAC sans liste d'édition). Sans ça, l'onde serait en avance d'~45 ms.
  const mediaScale = trak.mdia?.mdhd?.timescale || samples[0].timescale;
  const edit = trak.edts?.elst?.entries?.find((e) => e.media_time >= 0);
  const shift = edit ? edit.media_time / mediaScale : String(track.codec).startsWith('mp4a') ? 2112 / config.sampleRate : 0;

  const chans = Math.min(2, config.numberOfChannels);
  const n = bucketsFor(dur);
  const raw = Array.from({ length: chans }, () => new Float32Array(n));
  let decodeError = null, frame = null;

  const decoder = new AudioDecoder({
    output: (ad) => {
      try {
        const fr = ad.numberOfFrames, sr = ad.sampleRate, t0 = ad.timestamp / 1e6 - shift;
        if (!frame || frame.length < fr) frame = new Float32Array(fr);
        for (let c = 0; c < chans; c++) {
          ad.copyTo(frame, { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: 'f32-planar' });
          const out = raw[c];
          for (let i = 0; i < fr; i++) {
            const idx = Math.floor(((t0 + i / sr) / dur) * n);
            if (idx < 0 || idx >= n) continue;
            const v = Math.abs(frame[i]);
            if (v > out[idx]) out[idx] = v;
          }
        }
      } finally { ad.close(); }
    },
    error: (e) => { decodeError = e; },
  });
  decoder.configure(config);

  // on lit les échantillons par blocs contigus (un « chunk » audio = une seule lecture)
  let i = 0;
  while (i < samples.length && !decodeError) {
    let j = i;
    const start = samples[i].offset;
    let end = start + samples[i].size;
    while (j + 1 < samples.length && samples[j + 1].offset === end && end - start < (4 << 20)) { j++; end += samples[j].size; }
    const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
    for (let k = i; k <= j; k++) {
      const s = samples[k];
      decoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: Math.round((s.cts / s.timescale) * 1e6),
        duration: Math.round((s.duration / s.timescale) * 1e6),
        data: bytes.subarray(s.offset - start, s.offset - start + s.size),
      }));
    }
    i = j + 1;
    // ne pas empiler des milliers de morceaux dans la file du décodeur
    while (decoder.decodeQueueSize > 64 && !decodeError) await new Promise((r) => setTimeout(r, 0));
    onProgress?.(i / samples.length);
  }
  if (!decodeError) await decoder.flush();
  try { decoder.close(); } catch {}
  if (decodeError) throw new Error(`Décodage du son impossible : ${decodeError.message || decodeError}`);
  return toPeaks(raw);
}

// format stocké : base64 des pics mono (ancien format) ou "2:" + base64(gauche puis droite)
export const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return btoa(s); };

export const encodePeaks = ({ l, r }) => {
  if (!r) return bytesToB64(l);
  const all = new Uint8Array(l.length + r.length);
  all.set(l); all.set(r, l.length);
  return `2:${bytesToB64(all)}`;
};

// Méthode simple, tout format lisible par le navigateur (WebM, MKV, MP3…) : on décode tout le son en mémoire.
// Réservée aux fichiers raisonnables (le son décodé prend ~10 Mo par minute). dur : durée de la timeline, sinon celle du son.
export async function peaksFromBuffer(arrayBuffer, dur) {
  let audio;
  try { audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(arrayBuffer); } catch { return null; }
  const total = Number.isFinite(dur) && dur > 0 ? dur : audio.duration;
  const n = bucketsFor(total);
  const chans = Math.min(2, audio.numberOfChannels);
  const raw = [];
  for (let c = 0; c < chans; c++) {
    const d = audio.getChannelData(c), out = new Float32Array(n), sr = audio.sampleRate;
    for (let i = 0; i < n; i++) {
      const a = Math.floor(((i * total) / n) * sr), b = Math.min(d.length, Math.floor((((i + 1) * total) / n) * sr));
      const step = Math.max(1, Math.floor((b - a) / 64));
      let m = 0;
      for (let j = a; j < b; j += step) { const v = Math.abs(d[j]); if (v > m) m = v; }
      out[i] = m;
    }
    raw.push(out);
  }
  return toPeaks(raw);
}
