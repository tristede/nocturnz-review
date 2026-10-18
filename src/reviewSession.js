export function readSession(key, source) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value && value.source === source ? value : null;
  } catch { return null; }
}
export function writeSession(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
