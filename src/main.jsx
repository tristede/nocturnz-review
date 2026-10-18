import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import App from './App';
import './styles.css';

// Les gestes de zoom sont gérés par les moniteurs et la timeline, sans agrandir la page.
const preventPageZoom = (event) => {
  if (event.ctrlKey || event.metaKey) event.preventDefault();
};
window.addEventListener('wheel', preventPageZoom, { passive: false, capture: true });
const preventZoomKey = (event) => {
  if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) event.preventDefault();
};
const preventGesture = (event) => event.preventDefault();
window.addEventListener('keydown', preventZoomKey, { capture: true });
for (const type of ['gesturestart', 'gesturechange']) {
  window.addEventListener(type, preventGesture, { passive: false });
}
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener('wheel', preventPageZoom, { capture: true });
  window.removeEventListener('keydown', preventZoomKey, { capture: true });
  for (const type of ['gesturestart', 'gesturechange']) window.removeEventListener(type, preventGesture);
});

// Les panneaux de réglages se referment au clic extérieur et avec Échap.
const dismissDetails = (event) => {
  for (const panel of document.querySelectorAll('details[open]')) {
    if (event.type === 'keydown' ? event.key === 'Escape' : !panel.contains(event.target)) panel.open = false;
  }
};
document.addEventListener('pointerdown', dismissDetails);
document.addEventListener('keydown', dismissDetails);
if (import.meta.hot) import.meta.hot.dispose(() => {
  document.removeEventListener('pointerdown', dismissDetails);
  document.removeEventListener('keydown', dismissDetails);
});

// l'ancien service worker de lecture Drive n'a plus lieu d'être : on le retire chez ceux qui l'ont encore
navigator.serviceWorker?.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
