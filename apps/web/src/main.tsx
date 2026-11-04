import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/overlay';
import { AppDataProvider } from './hooks/useAppData';
import { DashboardPage } from './pages/DashboardPage';
import { QcListPage } from './pages/QcListPage';
import { QcDetailPage } from './pages/QcDetailPage';
import { KnowledgeListPage } from './pages/KnowledgeListPage';
import { KnowledgeDetailPage } from './pages/KnowledgeDetailPage';
import { BadcaseListPage } from './pages/BadcaseListPage';
import { BadcaseDetailPage } from './pages/BadcaseDetailPage';
import { CommentListPage } from './pages/CommentListPage';
import { AlertDetailPage } from './pages/AlertDetailPage';
import { ClueListPage } from './pages/ClueListPage';
import { EvalCenterPage } from './pages/EvalCenterPage';
import { AboutPage } from './pages/AboutPage';

import './styles/tokens.css';
import './styles/global.css';
import './styles/components.css';

function RouterContent() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/qc" element={<QcListPage />} />
      <Route path="/qc/:id" element={<QcDetailPage />} />
      <Route path="/knowledge" element={<KnowledgeListPage />} />
      <Route path="/knowledge/:id" element={<KnowledgeDetailPage />} />
      <Route path="/badcases" element={<BadcaseListPage />} />
      <Route path="/badcases/:id" element={<BadcaseDetailPage />} />
      <Route path="/sentiment" element={<CommentListPage />} />
      <Route path="/sentiment/alerts/:id" element={<AlertDetailPage />} />
      <Route path="/clues" element={<ClueListPage />} />
      <Route path="/eval" element={<EvalCenterPage />} />
      <Route path="/about" element={<AboutPage />} />
    </Routes>
  );
}

export default function App() {
  return (
    <StrictMode>
      <BrowserRouter>
        <AppDataProvider>
          <ToastProvider>
            <AppShell>
              <RouterContent />
            </AppShell>
          </ToastProvider>
        </AppDataProvider>
      </BrowserRouter>
    </StrictMode>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
