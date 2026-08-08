import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { Shell } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { Bookings } from './pages/Bookings';
import { Customers } from './pages/Customers';
import { Payout } from './pages/Payout';
import { Approvals } from './pages/Approvals';
import { Partners } from './pages/Partners';
import { Reviews } from './pages/Reviews';
import { Promos } from './pages/Promos';
import { Content } from './pages/Content';
import { Settings } from './pages/Settings';
import { c, f } from './theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A 401 is handled by the api client's refresh; retrying a 403 or 404 in
      // the UI only delays the error the admin needs to see.
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        if (status && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function Root() {
  const { admin, loading, can } = useAuth();

  if (loading) return <Splash />;
  if (!admin) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="customers" element={<Customers />} />
        <Route
          path="payout"
          element={can('super_admin', 'finance') ? <Payout /> : <Navigate to="/" replace />}
        />
        <Route path="approvals" element={<Approvals />} />
        <Route path="partners" element={<Partners />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="promos" element={<Promos />} />
        <Route path="content" element={<Content />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function Splash() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: c.pageOuter,
        gap: 16,
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 44,
            height: 44,
            border: `3px solid ${c.border}`,
            borderTopColor: c.accent,
            borderRadius: '50%',
            margin: '0 auto 16px',
            animation: 'laostaySpin .8s linear infinite',
          }}
        />
        <div style={{ font: f(600, 13), color: c.muted }}>ກຳລັງໂຫຼດ LaoStay Admin...</div>
      </div>
    </div>
  );
}
