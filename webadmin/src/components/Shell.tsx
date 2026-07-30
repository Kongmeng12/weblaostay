import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { c, f, radius, avatarFor } from '../theme';
import { initials } from '../lib/format';

interface NavItem {
  to: string;
  name: string;
  emoji: string;
  title: string;
  subtitle: string;
  /** Roles allowed to see the entry. Undefined means everyone. */
  roles?: ('super_admin' | 'finance' | 'staff')[];
}

export const NAV: NavItem[] = [
  { to: '/', name: 'ແດຊບອຣ໌ດ', emoji: '▦', title: 'ແດຊບອຣ໌ດ · Dashboard', subtitle: 'ພາບລວມລະບົບ ຈອງ & ການເງິນ' },
  { to: '/bookings', name: 'ການຈອງ', emoji: '🧾', title: 'ການຈອງທັງໝົດ', subtitle: 'ຈັດການການຈອງໃນລະບົບ' },
  { to: '/customers', name: 'ລູກຄ້າ', emoji: '👥', title: 'ລູກຄ້າ', subtitle: 'ຈັດການບັນຊີລູກຄ້າ' },
  {
    to: '/payout',
    name: 'ການເງິນ · Payout',
    emoji: '💰',
    title: 'ຈັດການໂອນເງິນ · Payout',
    subtitle: 'ໂອນເງິນໃຫ້ Partner ລາຍສັປດາຫ໌',
    roles: ['super_admin', 'finance'],
  },
  { to: '/approvals', name: 'ອະນຸມັດ Partner', emoji: '🤝', title: 'ອະນຸມັດ Partner', subtitle: 'ກວດສອບໃບສະໝັກທີ່ພັກໃໝ່' },
  { to: '/partners', name: 'ທີ່ພັກ & Partner', emoji: '🏡', title: 'ທີ່ພັກ & Partner', subtitle: 'Partner ໃນລະບົບ' },
  { to: '/reviews', name: 'ຮີວິວ & ຂໍ້ພິພາດ', emoji: '⭐', title: 'ຮີວິວ & ຂໍ້ພິພາດ', subtitle: 'ດູແລຮີວິວ ແລະ ຂໍ້ຮ້ອງເຮັຍນ' },
  { to: '/promos', name: 'ໂຄ້ດສ່ວນຫຼຸດ', emoji: '🎟️', title: 'ໂຄ້ດສ່ວນຫຼຸດ', subtitle: 'ຈັດການໂຄ້ດສ່ວນຫຼຸດ & ໂປຣໂມຊັນ' },
  { to: '/settings', name: 'ຕັ້ງຄ່າ', emoji: '⚙️', title: 'ຕັ້ງຄ່າລະບົບ', subtitle: 'ຄ່າຄອມມິຊຊັນ, ຜູ້ດູແລ ແລະ ລະບົບ' },
];

export function Shell() {
  const { admin, signOut } = useAuth();
  const location = useLocation();

  // Drives the badge on "ອະນຸມັດ Partner" so it always reflects reality.
  const { data: approvalCounts } = useQuery({
    queryKey: ['approvals', 'counts'],
    queryFn: () => api.get<{ pending: number }>('/admin/approvals/counts'),
    refetchInterval: 60_000,
  });

  const visible = NAV.filter((n) => !n.roles || (admin && n.roles.includes(admin.role)));
  const current = [...NAV].reverse().find((n) => matches(location.pathname, n.to)) ?? NAV[0];

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: 24,
        background: c.pageOuter,
        minHeight: '100vh',
        fontFamily: "'Noto Sans Lao', sans-serif",
      }}
    >
      <div
        style={{
          width: 1440,
          maxWidth: '100%',
          minHeight: 'calc(100vh - 48px)',
          borderRadius: radius.lg,
          overflow: 'hidden',
          background: '#fff',
          boxShadow: '0 30px 70px -20px rgba(40,30,20,.5)',
          display: 'flex',
        }}
      >
        {/* ── sidebar ─────────────────────────────────────────────────────── */}
        <aside
          style={{
            width: 248,
            flex: 'none',
            background: `linear-gradient(160deg, ${c.sidebarFrom}, ${c.sidebarTo})`,
            display: 'flex',
            flexDirection: 'column',
            padding: '22px 14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 22px' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: c.accent,
                display: 'grid',
                placeItems: 'center',
                font: f(800, 18),
                color: '#fff',
              }}
            >
              L
            </div>
            <div>
              <div style={{ font: f(800, 15), color: '#fff' }}>LaoStay</div>
              <div style={{ font: f(400, 11), color: c.onDarkSoft }}>Web Admin</div>
            </div>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
            {visible.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '11px 12px',
                  borderRadius: radius.md,
                  font: f(600, 13),
                  textDecoration: 'none',
                  background: isActive ? c.accent : 'transparent',
                  color: isActive ? '#fff' : c.onDark,
                  transition: 'background .15s',
                })}
                onMouseEnter={(e) => {
                  if (!e.currentTarget.style.background.includes('253')) return;
                }}
              >
                {({ isActive }) => (
                  <>
                    <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>
                      {item.emoji}
                    </span>
                    <span style={{ flex: 1 }}>{item.name}</span>
                    {item.to === '/approvals' && !!approvalCounts?.pending && (
                      <span
                        style={{
                          minWidth: 20,
                          height: 20,
                          padding: '0 6px',
                          borderRadius: 10,
                          background: isActive ? '#fff' : c.accent,
                          color: isActive ? c.accent : '#fff',
                          font: f(700, 11),
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        {approvalCounts.pending}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div
            style={{
              borderTop: '1px solid rgba(255,255,255,.1)',
              paddingTop: 14,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: avatarFor(admin?.email ?? 'a'),
                display: 'grid',
                placeItems: 'center',
                font: f(700, 13),
                color: '#fff',
                flex: 'none',
              }}
            >
              {initials(admin?.name ?? '?')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  font: f(700, 12),
                  color: '#fff',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {admin?.name}
              </div>
              <div style={{ font: f(400, 10), color: c.onDarkSoft }}>
                {admin?.roleLabel ?? admin?.role}
              </div>
            </div>
            <button
              title="ອອກຈາກລະບົບ"
              onClick={() => void signOut()}
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                color: '#8C7F6C',
                background: 'transparent',
                border: 'none',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </aside>

        {/* ── main ────────────────────────────────────────────────────────── */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            background: c.bg,
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 48px)',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '22px 28px',
              background: c.bg,
              borderBottom: `1px solid ${c.border}`,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            <div>
              <div style={{ font: f(800, 22), color: c.text }}>{current.title}</div>
              <div style={{ font: f(400, 13), color: c.muted, marginTop: 2 }}>
                {current.subtitle}
              </div>
            </div>
          </header>

          <div style={{ padding: 28 }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function matches(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}
