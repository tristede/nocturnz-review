// Petites icônes des sources et formats acceptés (dessinées ici, aux couleurs de chaque app).
const Tile = ({ bg, children, fg = '#fff' }) => (
  <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden>
    <rect width="32" height="32" rx="7" fill={bg} />
    <g fill={fg}>{children}</g>
  </svg>
);
const Label = ({ t, size = 11, y = 20.5, fill }) => (
  <text x="16" y={y} textAnchor="middle" fontSize={size} fontWeight="700" fontFamily="Inter, system-ui, sans-serif" fill={fill} letterSpacing="-.02em">{t}</text>
);

export const APP_ICONS = {
  drive: (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#fff" />
      <path d="M12.6 6h6.8l7.4 12.8h-6.8z" fill="#FBBC04" />
      <path d="M12.6 6l3.4 5.9-7.4 12.8-3.4-5.9z" fill="#0F9D58" />
      <path d="M8.6 24.7l3.4-5.9h14.8l-3.4 5.9z" fill="#4285F4" />
    </svg>
  ),
  youtube: (
    <Tile bg="#fff">
      <rect x="5" y="9" width="22" height="15" rx="4.5" fill="#FF0033" />
      <path d="M14 12.6v7.8l6.6-3.9z" fill="#fff" />
    </Tile>
  ),
  video: (
    <Tile bg="#7b67ef">
      <rect x="7" y="10" width="13" height="12" rx="2.5" />
      <path d="M21.5 14.2l4-2.4v8.4l-4-2.4z" />
    </Tile>
  ),
  image: (
    <Tile bg="#2a2a3a">
      <circle cx="21.5" cy="11" r="2.6" fill="#e5bd78" />
      <path d="M5.5 24l7.2-9.5 5 6.2 3-3.6 5.8 6.9z" fill="#8e7bff" />
    </Tile>
  ),
  svg: (
    <Tile bg="#FFB13B">
      <path d="M8 22c3-11 13-11 16 0" fill="none" stroke="#1d1300" strokeWidth="2" strokeLinecap="round" />
      <rect x="5.5" y="19.5" width="5" height="5" rx="1" fill="#fff" stroke="#1d1300" strokeWidth="1.4" />
      <rect x="21.5" y="19.5" width="5" height="5" rx="1" fill="#fff" stroke="#1d1300" strokeWidth="1.4" />
      <rect x="13.5" y="6" width="5" height="5" rx="1" fill="#1d1300" />
    </Tile>
  ),
  pdf: (
    <Tile bg="#E5252A">
      <Label t="PDF" size={10.5} />
    </Tile>
  ),
  word: (
    <Tile bg="#185ABD">
      <Label t="W" size={17} y={22} />
    </Tile>
  ),
  psd: (
    <Tile bg="#001E36">
      <Label t="Ps" size={15} y={21.5} fill="#31A8FF" />
    </Tile>
  ),
  gdoc: (
    <svg viewBox="0 0 32 32" width="100%" height="100%" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#fff" />
      <path d="M9 5h10l5 5v16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 26V6.5A1.5 1.5 0 0 1 9 5z" fill="#4285F4" />
      <path d="M19 5v5h5z" fill="#A1C2FA" />
      <rect x="11" y="15" width="10" height="1.6" rx=".8" fill="#fff" />
      <rect x="11" y="18.4" width="10" height="1.6" rx=".8" fill="#fff" />
      <rect x="11" y="21.8" width="7" height="1.6" rx=".8" fill="#fff" />
    </svg>
  ),
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
