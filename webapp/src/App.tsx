import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { ApiError } from './lib/api';

import { HomePage } from './pages/Home';
import { SearchPage } from './pages/Search';
import { PropertyPage } from './pages/Property';
import { CheckoutPage } from './pages/Checkout';
import { PayPage } from './pages/Pay';
import { TripsPage } from './pages/Trips';
import { TripDetailPage } from './pages/TripDetail';
import { WishlistPage } from './pages/Wishlist';
import { NotificationsPage } from './pages/Notifications';
import { MessagesPage, ThreadPage } from './pages/Messages';
import { AccountPage } from './pages/Account';
import { SignInPage } from './pages/SignIn';
import { SignUpPage } from './pages/SignUp';
import { ForgotPasswordPage } from './pages/ForgotPassword';
import { HelpPage, StaticPage } from './pages/Content';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // A 401 has already been retried once with a fresh token inside the API
      // client; retrying here would only repeat a request that cannot succeed.
      // 404 and 409 are answers, not failures.
      retry: (count, error) => {
        if (error instanceof ApiError && error.status < 500) return false;
        return count < 2;
      },
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route element={<Layout />}>
              {/* Public: browsing needs no account. */}
              <Route index element={<HomePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="property/:id" element={<PropertyPage />} />
              <Route path="signin" element={<SignInPage />} />
              <Route path="signup" element={<SignUpPage />} />
              <Route path="forgot" element={<ForgotPasswordPage />} />
              <Route path="help" element={<HelpPage />} />
              <Route path="p/:slug" element={<StaticPage />} />

              {/* Everything that touches a real booking. */}
              <Route
                path="checkout"
                element={
                  <RequireAuth>
                    <CheckoutPage />
                  </RequireAuth>
                }
              />
              <Route
                path="pay/:bookingId"
                element={
                  <RequireAuth>
                    <PayPage />
                  </RequireAuth>
                }
              />
              <Route
                path="trips"
                element={
                  <RequireAuth>
                    <TripsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="trips/:id"
                element={
                  <RequireAuth>
                    <TripDetailPage />
                  </RequireAuth>
                }
              />
              <Route
                path="messages"
                element={
                  <RequireAuth>
                    <MessagesPage />
                  </RequireAuth>
                }
              />
              <Route
                path="messages/:id"
                element={
                  <RequireAuth>
                    <ThreadPage />
                  </RequireAuth>
                }
              />
              <Route
                path="wishlist"
                element={
                  <RequireAuth>
                    <WishlistPage />
                  </RequireAuth>
                }
              />
              <Route
                path="notifications"
                element={
                  <RequireAuth>
                    <NotificationsPage />
                  </RequireAuth>
                }
              />
              <Route
                path="account"
                element={
                  <RequireAuth>
                    <AccountPage />
                  </RequireAuth>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * Sends a signed-out visitor to sign in, carrying where they were headed so
 * they land back on it — losing a half-chosen booking to a login redirect is
 * how a guest gives up.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="ກຳລັງກວດເຊສຊັນ..." />;
  if (!user) {
    return (
      <Navigate
        to="/signin"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }
  return <>{children}</>;
}
