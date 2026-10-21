import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { c, f, radius, MAX_WIDTH, space, TAP, type as t } from '../theme';
import { initials } from '../lib/format';
import { usePublishedPages } from '../pages/Content';
import type { NotificationFeed } from '../lib/types';

/**
 * The app shell, laid out like the customer app.
 *
 * On a phone: a slim header (wordmark plus round icon buttons) and the app's
 * five-tab bar fixed to the bottom. From 861px the same tabs move up into the
 * header as pills — a bottom bar on a laptop is a phone pattern out of place.
 * Screens the app opens *over* its tabs (a stay, checkout, payment, a single
 * trip or conversation) hide the bar here too, which also keeps it from
 * covering their own sticky booking bar.
 */
export function Layout() {
  const { user } = useAuth();
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

  const tabbar = showsTabBar(location.pathname);
  const from = { from: location.pathname + location.search };

  return (
    <div
      className={tabbar ? 'phaphak-has-tabbar' : undefined}
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: c.page }}
    >
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'rgba(251,246,239,.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: `1px solid ${c.border}`,
        }}
      >
        <div
          style={{
            maxWidth: MAX_WIDTH,
            margin: '0 auto',
            padding: '10px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: space[4],
          }}
        >
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: TAP, flex: 'none' }}>
            <img src="/logo.png" alt="" style={{ height: 36, width: 36, borderRadius: '50%' }} />
            <span style={{ font: f(700, 22, 28), letterSpacing: -0.5, color: c.accent }}>Phapai</span>
          </Link>

          <nav className="phaphak-topnav" style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: space[3] }}>
            {TABS.map((tab) => (
              <TopTab key={tab.to} to={tab.to} end={tab.to === '/'}>
                {tab.label}
              </TopTab>
            ))}
          </nav>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: space[2] }}>
            <Link
              to="/partner-register"
              className="phaphak-topnav phaphak-wide-only"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                minHeight: 40,
                padding: `0 ${space[4]}px`,
                borderRadius: radius.pill,
                border: `1px solid ${c.border}`,
                background: c.surface,
                color: c.text,
                font: t.label,
                whiteSpace: 'nowrap',
              }}
            >
              ສະໝັກ Partner
            </Link>

            {user ? (
              <>
                <RoundIcon to="/messages" label="ຂໍ້ຄວາມ" badge={chat?.unreadTotal}>
                  <ChatIcon />
                </RoundIcon>
                <RoundIcon to="/notifications" label="ແຈ້ງເຕືອນ" badge={feed?.unread}>
                  <BellIcon />
                </RoundIcon>
                <Link
                  to="/account"
                  className="phaphak-topnav"
                  title={user.fullName ?? user.email}
                  aria-label="ໂປຣໄຟລ໌"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: c.accentSoft,
                    color: c.accentDark,
                    display: 'grid',
                    placeItems: 'center',
                    font: f(800, 14),
                  }}
                >
                  {initials(user.fullName ?? user.email)}
                </Link>
              </>
            ) : (
              <Link
                to="/signin"
                state={from}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: 40,
                  padding: `0 ${space[4]}px`,
                  borderRadius: radius.pill,
                  background: c.accent,
                  color: '#fff',
                  font: f(700, 13.5, 20),
                  whiteSpace: 'nowrap',
                }}
              >
                ເຂົ້າສູ່ລະບົບ
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Deliberately unclamped. Every page sets its own width through `Page`,
          so a max-width here would only trap anything meant to run edge to
          edge. */}
      <main style={{ flex: 1, width: '100%' }}>
        <Outlet />
      </main>

      <footer
        style={{
          background: c.dark,
          color: c.onDarkSoft,
          marginTop: space[7],
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img src="/logo.png" alt="" style={{ height: 36, width: 36, borderRadius: '50%' }} />
            <div>
              <div style={{ font: f(700, 18, 24), color: '#fff' }}>Phapai</div>
              <div style={{ font: t.caption }}>ຈອງທີ່ພັກທົ່ວລາວ</div>
            </div>
          </div>

          {/* Only pages the admin has actually published — the index leaves out
              anything still a draft, so no link here can lead to a 404. */}
          <nav style={{ display: 'flex', gap: space[3], flexWrap: 'wrap' }}>
            <Link to="/help" style={footLink}>
              ຊ່ວຍເຫຼືອ
            </Link>
            <Link to="/partner-register" style={footLink}>
              ສະໝັກ Partner
            </Link>
            {pages.map((p) => (
              <Link key={p.slug} to={`/p/${p.slug}`} style={footLink}>
                {p.title}
              </Link>
            ))}
          </nav>

          <div style={{ font: t.caption }}>© 2026 Phapai · ສະຫງວນລິຂະສິດ</div>
        </div>
      </footer>

      {tabbar && <TabBar signedIn={!!user} />}
    </div>
  );
}

/**
 * The app's `AppBottomNav` tabs. "ການຈອງ" is the trips list — the website has
 * one list where the app splits upcoming from past. Profile goes to sign-in
 * for a visitor, so the tab is never a dead end.
 */
const TABS: { to: string; label: string; icon: () => ReactNode }[] = [
  { to: '/', label: 'ໜ້າຫຼັກ', icon: HomeIcon },
  { to: '/search', label: 'ຄົ້ນຫາ', icon: SearchIcon },
  { to: '/trips', label: 'ການຈອງ', icon: CalendarIcon },
  { to: '/wishlist', label: 'ທີ່ມັກ', icon: HeartIcon },
  { to: '/account', label: 'ໂປຣໄຟລ໌', icon: PersonIcon },
];

/** Screens the app pushes over its tab bar rather than showing inside it. */
function showsTabBar(path: string): boolean {
  return !/^\/(property|checkout|pay|signin|signup|forgot|c)(\/|$)|^\/(trips|messages)\/[^/]+/.test(path);
}

function TabBar({ signedIn }: { signedIn: boolean }) {
  return (
    <nav
      className="phaphak-tabbar"
      aria-label="ເມນູຫຼັກ"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 45,
        gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        background: c.page,
        borderTop: `1px solid ${c.border}`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={!signedIn && tab.to === '/account' ? '/signin' : tab.to}
          end={tab.to === '/'}
          style={({ isActive }) => ({
            height: 68,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            color: isActive ? c.accent : c.inactive,
            font: f(600, 10.5, 14),
          })}
        >
          <tab.icon />
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** A header tab on a wide screen — the app's `PillChip`: ink when selected. */
function TopTab({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 38,
        padding: `0 ${space[4]}px`,
        borderRadius: radius.pill,
        font: f(600, 13, 20),
        whiteSpace: 'nowrap',
        color: isActive ? c.page : c.text,
        background: isActive ? c.dark : 'transparent',
      })}
    >
      {children}
    </NavLink>
  );
}

/** The app's round sand icon button, with its unread dot. */
function RoundIcon({
  to,
  label,
  badge,
  children,
}: {
  to: string;
  label: string;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      aria-label={badge ? `${label} (${badge})` : label}
      title={label}
      style={({ isActive }) => ({
        position: 'relative',
        width: 44,
        height: 44,
        borderRadius: '50%',
        background: isActive ? c.dark : c.bg,
        color: isActive ? c.page : c.text,
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      })}
    >
      {children}
      {!!badge && (
        <span
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 18,
            height: 18,
            padding: '0 4px',
            borderRadius: 9,
            background: c.accent,
            border: `2px solid ${c.page}`,
            color: '#fff',
            font: f(800, 9.5, 14),
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
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

// ── icons ────────────────────────────────────────────────────────────────────
// Line icons in the weight of the app's rounded Material set, inline so the
// shell ships no icon font.

function Svg({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function HomeIcon() {
  return (
    <Svg>
      <path d="M3.5 10.5 12 3.5l8.5 7V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5 1.5 0 0 1 3.5 19z" />
    </Svg>
  );
}

function SearchIcon() {
  return (
    <Svg>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  );
}

function CalendarIcon() {
  return (
    <Svg>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  );
}

function HeartIcon() {
  return (
    <Svg>
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
    </Svg>
  );
}

function PersonIcon() {
  return (
    <Svg>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5" />
    </Svg>
  );
}

function BellIcon() {
  return (
    <Svg size={22}>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Svg>
  );
}

function ChatIcon() {
  return (
    <Svg size={22}>
      <path d="M20.5 12a8 8 0 0 1-11.8 7L3.5 20.5 5 16a8 8 0 1 1 15.5-4z" />
    </Svg>
  );
}
