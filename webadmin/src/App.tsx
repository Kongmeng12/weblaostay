import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage } from './auth/LoginPage';
import { Shell } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { Bookings } from './pages/Bookings';
import { Customers } from './pages/Customers';
import { Payout } from './pages/Payout';
import { Refunds } from './pages/Refunds';
import { Approvals } from './pages/Approvals';
import { Partners } from './pages/Partners';
import { Properties } from './pages/Properties';
import { Reviews } from './pages/Reviews';
import { ReviewReports } from './pages/ReviewReports';
import { Promos } from './pages/Promos';
import {
  ContentAnnouncements,
  ContentBanners,
  ContentFaqs,
  ContentPages,
} from './pages/Content';
import {
  SettingsAdmins,
  SettingsAudit,
  SettingsFees,
  SettingsOperations,
  SettingsPlatform,
} from './pages/Settings';
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
        <Route
          path="refunds"
          element={can('super_admin', 'finance') ? <Refunds /> : <Navigate to="/" replace />}
        />
        <Route path="approvals" element={<Approvals />} />
        <Route path="partners" element={<Partners />} />
        <Route path="properties" element={<Properties />} />
        <Route path="reviews" element={<Reviews />} />
        <Route path="review-reports" element={<ReviewReports />} />
        <Route path="promos" element={<Promos />} />

        {/* Each CMS table is its own screen, reached from the sidebar. The bare
            /content path is kept so old links and bookmarks still land. */}
        <Route path="content" element={<Navigate to="/content/banners" replace />} />
        <Route path="content/banners" element={<ContentBanners />} />
        <Route path="content/announcements" element={<ContentAnnouncements />} />
        <Route path="content/faqs" element={<ContentFaqs />} />
        <Route path="content/pages" element={<ContentPages />} />

        <Route path="settings" element={<Navigate to="/settings/platform" replace />} />
        <Route path="settings/platform" element={<SettingsPlatform />} />
        <Route path="settings/fees" element={<SettingsFees />} />
        <Route path="settings/operations" element={<SettingsOperations />} />
        <Route path="settings/admins" element={<SettingsAdmins />} />
        <Route path="settings/audit" element={<SettingsAudit />} />

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
            animation: 'phaphakSpin .8s linear infinite',
          }}
        />
        <div style={{ font: f(600, 13), color: c.muted }}>ກຳລັງໂຫຼດ PhaPhak Admin...</div>
      </div>
    </div>
  );
}
