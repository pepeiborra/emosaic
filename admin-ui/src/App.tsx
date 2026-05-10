import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './hooks/useAuth';
import { I18nProvider } from './i18n';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Callback } from './pages/Callback';
import { Dashboard } from './pages/Dashboard';
import { CreateMosaic } from './pages/CreateMosaic';
import { MosaicDetail } from './pages/MosaicDetail';
import { JobStatus } from './pages/JobStatus';
import { UserManagement } from './pages/UserManagement';
import { UploadImages } from './pages/UploadImages';
import { ErrorLogs } from './pages/ErrorLogs';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

function App() {
  // Use Vite's BASE_URL for the router basename (e.g., /admin/ in production)
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={basename}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/callback" element={<Callback />} />
              <Route
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route path="/" element={<Dashboard />} />
                <Route path="/create" element={<CreateMosaic />} />
                <Route path="/mosaic/:id" element={<MosaicDetail />} />
                <Route path="/job/:id" element={<JobStatus />} />
                <Route path="/users" element={<UserManagement />} />
                <Route path="/upload" element={<UploadImages />} />
                <Route path="/errors" element={<ErrorLogs />} />
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  );
}

export default App;
