import { COLORS, TOOLS } from './draw';

// only : restreint la liste des outils ; sans onUndo, pas de bouton « Annuler » (le mobile a le sien)
export default function DrawingToolbar({ tool, onTool, color, onColor, canUndo, onUndo, only = null }) {
  return <div className="tools draw-options" role="toolbar" aria-label="Outils de dessin">
    <div className="seg-ctl">{TOOLS.filter(([key]) => !only || only.includes(key)).map(([key, label]) => <button key={key} className={tool === key ? 'on' : ''} aria-pressed={tool === key} onClick={() => onTool(key)}>{label}</button>)}</div>
    <span className="sw">{COLORS.map((value) => <button key={value} className={value === color ? 'on' : ''} aria-label={`Couleur ${value}`} aria-pressed={value === color} style={{ background: value }} onClick={() => onColor(value)} />)}</span>
    {onUndo && <button className="ghost sm" disabled={!canUndo} onClick={onUndo}>Annuler</button>}
  </div>;
}
