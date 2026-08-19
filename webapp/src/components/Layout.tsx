import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { c, f, radius, MAX_WIDTH, space, TAP, type as t } from '../theme';
import { initials } from '../lib/format';
import { usePublishedPages } from '../pages/Content';
import type { NotificationFeed } from '../lib/types';

export function Layout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const pages = usePublishedPages();

  // Only asked for when signed in — an anonymous visitor has no notifications
  // and the request would just be a 401.
  const { data: feed } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationFeed>('/customer/notifications'),
    enabled: !!user,
    refetchInterval: 60_000,
  });

  // Same rule as the notification badge: only asked for when signed in.
  const { data: chat } = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<{ unreadTotal: number }>('/customer/conversations'),
    enabled: !!user,
    refetchInterval: 60_000,
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(255,255,255,.92)',
          backdropFilter: 'blur(10px)',
          borderBottom: `1px solid ${c.border}`,
        }}
      >
        <div
          style={{
            maxWidth: MAX_WIDTH,
            margin: '0 auto',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 18,
          }}
        >
          <Link
            to="/"
            style={{ display: 'flex', alignItems: 'center', minHeight: TAP, gap: space[2] }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                background: c.accent,
                display: 'grid',
                placeItems: 'center',
                font: t.h3,
                color: '#fff',
              }}
            >
              L
            </div>
            <span style={{ font: t.h3, color: c.text }}>LaoStay</span>
          </Link>

          <nav style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <HeaderLink to="/search">ຄົ້ນຫາ</HeaderLink>
            {user && (
              <>
                <HeaderLink to="/trips">ການເດີນທາງ</HeaderLink>
                <HeaderLink to="/messages" badge={chat?.unreadTotal}>
                  ຂໍ້ຄວາມ
                </HeaderLink>
                <HeaderLink to="/wishlist">ທີ່ມັກ</HeaderLink>
                <HeaderLink to="/notifications" badge={feed?.unread}>
                  ແຈ້ງເຕືອນ
                </HeaderLink>
              </>
            )}

            {user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 8 }}>
                <Link
                  to="/account"
                  title={user.fullName ?? user.email}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    background: c.accentSoft,
                    color: c.accentDark,
                    display: 'grid',
                    placeItems: 'center',
                    font: f(700, 13),
                  }}
                >
                  {initials(user.fullName ?? user.email)}
                </Link>
                <button
                  onClick={() => void signOut()}
                  style={{
                    background: 'none',
                    border: 'none',
                    minHeight: TAP,
                    padding: `0 ${space[2]}px`,
                    font: t.caption,
                    color: c.muted,
                    cursor: 'pointer',
                  }}
                >
                  ອອກ
                </button>
              </div>
            ) : (
              <Link
                to="/signin"
                state={{ from: location.pathname + location.search }}
                style={{
                  marginLeft: space[2],
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: TAP,
                  padding: `0 ${space[4]}px`,
                  borderRadius: radius.md,
                  background: c.accent,
                  color: '#fff',
                  font: f(700, 13),
                }}
              >
                ເຂົ້າສູ່ລະບົບ
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Deliberately unclamped. Every page sets its own width through `Page`,
          so a max-width here bought nothing — except that it also trapped the
          home page's hero band, which is meant to run edge to edge like the
          footer does and instead sat as a 1084px rectangle floating in white
          on any screen wider than that. */}
      <main style={{ flex: 1, width: '100%' }}>
        <Outlet />
      </main>

      <footer
        style={{
          background: c.dark,
          color: c.onDarkSoft,
          marginTop: 48,
          padding: '32px 18px',
        }}
      >
        <div
          style={{
            maxWidth: MAX_WIDTH,
            margin: '0 auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 20,
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ font: t.h3, color: '#fff', marginBottom: 4 }}>LaoStay</div>
            <div style={{ font: t.caption }}>ຈອງທີ່ພັກທົ່ວລາວ</div>
          </div>

          {/* Only pages the admin has actually published — the index leaves out
              anything still a draft, so no link here can lead to a 404. */}
          <nav style={{ display: 'flex', gap: space[3], flexWrap: 'wrap' }}>
            <Link to="/help" style={footLink}>
              ຊ່ວຍເຫຼືອ
            </Link>
            {pages.map((p) => (
              <Link key={p.slug} to={`/p/${p.slug}`} style={footLink}>
                {p.title}
              </Link>
            ))}
          </nav>

          <div style={{ font: t.caption }}>© 2026 LaoStay · ສະຫງວນລິຂະສິດ</div>
        </div>
      </footer>
    </div>
  );
}

/** Footer links need the same 44px reach as anything else a thumb goes for. */
const footLink: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: TAP,
  font: t.caption,
  color: c.onDark,
};

function HeaderLink({
  to,
  children,
  badge,
}: {
  to: string;
  children: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: TAP,
        padding: `0 ${space[3]}px`,
        borderRadius: radius.md,
        font: t.label,
        color: isActive ? c.accentDark : c.soft,
        background: isActive ? c.accentSoft : 'transparent',
        position: 'relative',
      })}
    >
      {children}
      {!!badge && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 8,
            background: c.accent,
            color: '#fff',
            font: f(700, 10),
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}
