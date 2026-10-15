import { Route, Routes } from 'react-router-dom';
import Dashboard from './Dashboard';
import ReviewPage from './ReviewPage';
import ProjectPage from './ProjectPage';
import Notice from './Notice';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/r/:token" element={<ReviewPage />} />
      <Route path="/p/:pid" element={<ProjectPage />} />
      <Route path="*" element={<Notice title="Page introuvable" text="Cette adresse ne mène à rien." />} />
    </Routes>
  );
}
