import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import App from './App';
import './styles.css';

// lecture Drive par morceaux (voir public/drive-sw.js) : on attend qu'il soit actif avant d'afficher la vidéo,
// sinon la première visite partirait sans lui ; au pire on n'attend pas plus d'1,5 s
const swReady = !('serviceWorker' in navigator) ? Promise.resolve() : Promise.race([
  navigator.serviceWorker.register('/drive-sw.js').then(() => navigator.serviceWorker.controller || new Promise((r) => {
    navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
  })),
  new Promise((r) => setTimeout(r, 1500)),
]).catch(() => {});

swReady.then(() => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
));
