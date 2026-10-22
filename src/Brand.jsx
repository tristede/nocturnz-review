import { Link } from 'react-router-dom';

// Logo « nocturnz / review » : toujours en haut à gauche, ramène à l'accueil
export default function Brand({ className = '', style }) {
  return (
    <Link to="/" className={`brand ${className}`} style={style} title="Retour à l’accueil">
      <span>nocturnz</span><b>/ review</b>
    </Link>
  );
}

// Bouton de retour (vers le projet ou la liste des reviews)
export function BackButton({ to, label }) {
  return <Link className="back-btn" to={to}>← {label}</Link>;
}
