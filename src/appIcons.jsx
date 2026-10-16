// Icônes des sources et formats acceptés, façon « liquid glass » gris : le verre (flou, reflet) est dessiné
// en CSS (.app-ic), qui passe aussi les logos en niveaux de gris ; `tint` reste la couleur d'origine de l'app.
const G = ({ children }) => <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden>{children}</svg>;
const Label = ({ t, size = 11, y = 20.5, fill }) => (
  <text x="16" y={y} textAnchor="middle" fontSize={size} fontWeight="800" fontFamily="Inter, system-ui, sans-serif" fill={fill} letterSpacing="-.03em">{t}</text>
);

// tint = teinte du verre (couleur de l'app)
export const APP_ICONS = {
  drive: {
    tint: '#4285F4',
    glyph: (
      <G>
        <path d="M12.6 7h6.8l7 12.1h-6.8z" fill="#FBBC04" />
        <path d="M12.6 7l3.4 5.9-7 12.1-3.4-5.9z" fill="#0F9D58" />
        <path d="M9 25l3.4-5.9h14l-3.4 5.9z" fill="#4285F4" />
      </G>
    ),
  },
  youtube: {
    tint: '#FF0033',
    glyph: (
      <G>
        <rect x="5.5" y="9.5" width="21" height="14" rx="4.5" fill="#FF0033" />
        <path d="M14 13v7l6-3.5z" fill="#fff" />
      </G>
    ),
  },
  video: {
    tint: '#8e7bff',
    glyph: (
      <G>
        <rect x="6.5" y="10" width="13.5" height="12" rx="3" fill="#b3a6ff" />
        <path d="M21.5 14.2l4.5-2.6v8.8l-4.5-2.6z" fill="#b3a6ff" />
      </G>
    ),
  },
  image: {
    tint: '#8e7bff',
    glyph: (
      <G>
        <circle cx="21.5" cy="11" r="2.8" fill="#f2cf8d" />
        <path d="M5.5 24l7.2-9.5 5 6.2 3-3.6 5.8 6.9z" fill="#a898ff" />
      </G>
    ),
  },
  svg: {
    tint: '#FFB13B',
    glyph: (
      <G>
        <path d="M8 22c3-11 13-11 16 0" fill="none" stroke="#FFB13B" strokeWidth="2.2" strokeLinecap="round" />
        <rect x="5.5" y="19.5" width="5" height="5" rx="1.2" fill="#FFB13B" />
        <rect x="21.5" y="19.5" width="5" height="5" rx="1.2" fill="#FFB13B" />
        <rect x="13.5" y="6" width="5" height="5" rx="1.2" fill="#fff" />
      </G>
    ),
  },
  pdf: { tint: '#E5252A', glyph: <G><Label t="PDF" size={10.5} fill="#ff5a5f" /></G> },
  word: { tint: '#185ABD', glyph: <G><Label t="W" size={18} y={22.5} fill="#5b9bff" /></G> },
  psd: { tint: '#31A8FF', glyph: <G><Label t="Ps" size={15.5} y={21.5} fill="#31A8FF" /></G> },
  gdoc: {
    tint: '#4285F4',
    glyph: (
      <G>
        <path d="M10 5.5h9l5 5v15a1.5 1.5 0 0 1-1.5 1.5h-12.5A1.5 1.5 0 0 1 8.5 25.5V7A1.5 1.5 0 0 1 10 5.5z" fill="#4285F4" />
        <path d="M19 5.5v5h5z" fill="#A1C2FA" />
        <rect x="11.5" y="15" width="9" height="1.6" rx=".8" fill="#fff" />
        <rect x="11.5" y="18.4" width="9" height="1.6" rx=".8" fill="#fff" />
        <rect x="11.5" y="21.8" width="6" height="1.6" rx=".8" fill="#fff" />
      </G>
    ),
  },
};

// ce que le champ accepte, dans l'ordre d'affichage ; `match` = type détecté qui allume l'icône
export const ACCEPTED = [
  { key: 'drive', label: 'Google Drive', match: (d) => d?.source === 'drive' },
  { key: 'youtube', label: 'YouTube', match: (d) => d?.source === 'youtube' },
  { key: 'video', label: 'Vidéo', match: (d) => d?.source === 'drive' && d.kind === 'video' },
  { key: 'image', label: 'Image', match: (d) => d?.kind === 'image' && !d.svg },
  { key: 'svg', label: 'SVG', match: (d) => d?.kind === 'image' && d.svg },
  { key: 'pdf', label: 'PDF', match: (d) => d?.kind === 'pdf' },
  { key: 'word', label: 'Word', match: (d) => d?.kind === 'docx' },
  { key: 'psd', label: 'Photoshop', match: (d) => d?.kind === 'psd' },
  { key: 'gdoc', label: 'Google Docs', match: (d) => d?.kind === 'gdoc' },
];
