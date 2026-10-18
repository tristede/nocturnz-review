import { useRef, useState } from 'react';
import { validDeadline } from './deadlines';
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function DeadlineBadge({ value, label = false }) {
  if (!validDeadline(value)) return null;
  const today = todayKey(), late = value < today;
  const dateLabel = value === today ? 'Aujourd’hui' : new Date(`${value}T12:00:00`).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', year: value.slice(0, 4) !== today.slice(0, 4) ? 'numeric' : undefined });
  return <span className={`deadline-badge ${late ? 'late' : value === today ? 'today' : ''}`} title={`Échéance : ${value}${late ? ' · en retard' : ''}`}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 2v6m10-6v6M3 11h18" /></svg>{label && <span>Échéance ·</span>}<time dateTime={value}>{dateLabel}</time>{late && <span>· en retard</span>}</span>;
}

export default function ProjectDeadline({ value, onSave }) {
  const details = useRef(null);
  const [date, setDate] = useState(value || ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (next) => {
    if (next && !validDeadline(next)) { setError('Date invalide.'); return; }
    setBusy(true); setError('');
    try { await onSave(next || null); if (details.current) details.current.open = false; } catch { setError('Impossible d’enregistrer l’échéance.'); } finally { setBusy(false); }
  };
  return <details className="deadline-editor" ref={details} onToggle={(e) => { if (e.currentTarget.open) { setDate(value || ''); setError(''); } }}>
    <summary aria-label={value ? 'Modifier l’échéance' : 'Ajouter une échéance'}>{value ? <><DeadlineBadge value={value} label /><span className="deadline-edit-mark" aria-hidden="true">✎</span></> : '+ Échéance'}</summary>
    <form className="deadline-pop" onSubmit={(e) => { e.preventDefault(); save(String(new FormData(e.currentTarget).get('dueDate') || '')); }}>
      <label htmlFor="project-deadline">Échéance du projet</label>
      <input id="project-deadline" name="dueDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} max="9999-12-31" />
      <div className="row"><button className="sm" disabled={busy}>Enregistrer</button><button type="button" className="ghost sm" onClick={() => { details.current.open = false; }}>Annuler</button>{value && <button type="button" className="link" disabled={busy} onClick={() => save(null)}>Retirer</button>}</div>
      {error && <span className="mut" role="alert">{error}</span>}
    </form>
  </details>;
}
