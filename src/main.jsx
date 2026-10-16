import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import App from './App';
import './styles.css';

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
