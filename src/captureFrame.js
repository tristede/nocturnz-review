function mediaEvent(video, event, action) {
  return new Promise((resolve, reject) => {
    const finish = (error) => { clearTimeout(timer); video.removeEventListener(event, ok); video.removeEventListener('error', fail); error ? reject(error) : resolve(); };
    const ok = () => finish(), fail = () => finish(new Error('Capture indisponible : le stockage doit autoriser la lecture CORS (GET).'));
    const timer = setTimeout(() => finish(new Error('La frame n’a pas pu être chargée. Réessaie.')), 15000);
    video.addEventListener(event, ok, { once: true }); video.addEventListener('error', fail, { once: true });
    try { action(); } catch (e) { finish(e); }
  });
}

export async function captureAnnotatedFrame({ video, overlay, pins, filename, time }) {
  if (!(video instanceof HTMLVideoElement) || !video.videoWidth) throw new Error('La vidéo n’est pas prête.');
  const url = new URL(video.currentSrc || video.src, location.href);
  let frame = video, temporary = null;
  try {
    // Un lecteur CORS séparé évite de modifier ou de casser la lecture principale.
    if (url.origin !== location.origin && !['blob:', 'data:'].includes(url.protocol) && !video.crossOrigin) {
      temporary = document.createElement('video'); frame = temporary;
      frame.crossOrigin = 'anonymous'; frame.muted = true; frame.playsInline = true; frame.preload = 'metadata';
      await mediaEvent(frame, 'loadedmetadata', () => { frame.src = url.href; frame.load(); });
      await mediaEvent(frame, 'seeked', () => { frame.currentTime = Math.min(time + .00001, frame.duration - .00001); });
    } else if (video.seeking) await mediaEvent(video, 'seeked', () => {});
    if (frame.readyState < 2) throw new Error('La frame n’est pas encore disponible.');
    const canvas = document.createElement('canvas'); canvas.width = frame.videoWidth; canvas.height = frame.videoHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    if (overlay) {
      const svg = overlay.cloneNode(true);
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', canvas.width); svg.setAttribute('height', canvas.height);
      const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
      const imageUrl = URL.createObjectURL(blob);
      try {
        const img = new Image();
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('Impossible de capturer les dessins.')); img.src = imageUrl; });
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } finally { URL.revokeObjectURL(imageUrl); }
    }
    const radius = Math.max(12, Math.round(canvas.width / 80));
    for (const pin of pins) {
      const x = pin.x * canvas.width, y = pin.y * canvas.height;
      ctx.fillStyle = pin.draft ? '#ff5d73' : '#8659c9'; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `600 ${radius}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(pin.label), x, y);
    }
    const png = await new Promise((resolve, reject) => { try { canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Impossible de créer l’image.')), 'image/png'); } catch { reject(new Error('Capture bloquée par le stockage : autorise la lecture CORS (GET).')); } });
    const downloadUrl = URL.createObjectURL(png);
    const link = Object.assign(document.createElement('a'), { href: downloadUrl, download: filename });
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(downloadUrl), 30000);
    return { width: canvas.width, height: canvas.height };
  } finally {
    if (temporary) { temporary.pause(); temporary.removeAttribute('src'); temporary.load(); }
  }
}
