import Brand from './Brand';

// Page de message centrée (accès refusé, chargement, introuvable…)
export default function Notice({ title, text, children }) {
  return (
    <div className="wrap" style={{ maxWidth: 460, paddingTop: 120 }}>
      <Brand />
      <h1 style={{ fontSize: 34 }}>{title}</h1>
      {text && <p className="mut" style={{ marginBottom: 22 }}>{text}</p>}
      {children}
    </div>
  );
}
