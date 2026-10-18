import { COLORS, TOOLS } from './draw';

export default function DrawingToolbar({ tool, onTool, color, onColor, canUndo, onUndo }) {
  return <div className="tools draw-options" role="toolbar" aria-label="Outils de dessin">
    <div className="seg-ctl">{TOOLS.map(([key, label]) => <button key={key} className={tool === key ? 'on' : ''} aria-pressed={tool === key} onClick={() => onTool(key)}>{label}</button>)}</div>
    <span className="sw">{COLORS.map((value) => <button key={value} className={value === color ? 'on' : ''} aria-label={`Couleur ${value}`} aria-pressed={value === color} style={{ background: value }} onClick={() => onColor(value)} />)}</span>
    <button className="ghost sm" disabled={!canUndo} onClick={onUndo}>Annuler</button>
  </div>;
}
