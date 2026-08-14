import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type AdminRole } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { c, f, radius, avatarFor } from '../theme';
import { initials } from '../lib/format';

/** What each `admin_role` is called on screen. */
const ROLE_LABEL: Record<AdminRole, string> = {
  super_admin: 'ຜູ້ດູແລສູງສຸດ',
  finance: 'ຝ່າຍການເງິນ',
  staff: 'ພະນັກງານ',
};

interface NavItem {
  to: string;
  name: string;
  emoji: string;
  /** Shown in the page header once you are there. */
  title: string;
  subtitle: string;
  /** Roles allowed to see the entry. Undefined means everyone. */
  roles?: AdminRole[];
  /**
   * How wide the page's column should be. A form reads badly past ~860px;
   * a table wants the room. The header uses the same width so its title lines
   * up with the card underneath instead of floating off to the left.
   */
  width?: 'narrow' | 'medium';
}

/**
 * A collapsible heading in the sidebar.
 *
 * `key` is what the open/closed state is stored against, so renaming a group
 * on screen does not silently reset which ones an admin had open.
 */
interface NavGroup {
  key: string;
  name: string;
  items: NavItem[];
}

/**
 * The sidebar, defined once.
 *
 * Every page renders inside this shell through the router's `<Outlet/>`; no
 * page draws its own navigation, so adding a screen means adding a line here
 * and a `<Route>` in App.tsx — nothing else.
 *
 * Two entries stand alone at the top and bottom. The dashboard is where you
 * land and the settings are where you rarely go; burying either under a
 * heading you have to open first would cost a click for no grouping benefit.
 */
const DASHBOARD: NavItem = {
  to: '/',
  name: 'ແດຊບອຣ໌ດ',
  emoji: '▦',
  title: 'ແດຊບອຣ໌ດ · Dashboard',
  subtitle: 'ພາບລວມລະບົບ ຈອງ & ການເງິນ',
};

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'operations',
    name: 'ການດຳເນີນງານ',
    items: [
      {
        to: '/bookings',
        name: 'ການຈອງ',
        emoji: '🧾',
        title: 'ການຈອງທັງໝົດ',
        subtitle: 'ຈັດການການຈອງໃນລະບົບ',
      },
      {
        to: '/customers',
        name: 'ລູກຄ້າ',
        emoji: '👥',
        title: 'ລູກຄ້າ',
        subtitle: 'ຈັດການບັນຊີລູກຄ້າ',
      },
      {
        to: '/reviews',
        name: 'ຮີວິວ & ຂໍ້ພິພາດ',
        emoji: '⭐',
        title: 'ຮີວິວ & ຂໍ້ພິພາດ',
        subtitle: 'ດູແລຮີວິວ ແລະ ຂໍ້ຮ້ອງເຮັຍນ',
      },
      {
        to: '/review-reports',
        name: 'ລາຍງານຮີວິວ',
        emoji: '🚩',
        title: 'ລາຍງານຮີວິວ',
        subtitle: 'ຮີວິວທີ່ຖືກລາຍງານ ລໍການກວດສອບ',
        width: 'medium',
      },
    ],
  },
  {
    key: 'partners',
    name: 'Partner & ການເງິນ',
    items: [
      {
        to: '/approvals',
        name: 'ອະນຸມັດ Partner',
        emoji: '🤝',
        title: 'ອະນຸມັດ Partner',
        subtitle: 'ກວດສອບໃບສະໝັກທີ່ພັກໃໝ່',
      },
      {
        to: '/partners',
        name: 'ທີ່ພັກ & Partner',
        emoji: '🏡',
        title: 'ທີ່ພັກ & Partner',
        subtitle: 'Partner ໃນລະບົບ',
      },
      {
        to: '/payout',
        name: 'ການເງິນ · Payout',
        emoji: '💰',
        title: 'ຈັດການໂອນເງິນ · Payout',
        subtitle: 'ໂອນເງິນໃຫ້ Partner ລາຍສັປດາຫ໌',
        roles: ['super_admin', 'finance'],
      },
      {
        to: '/refunds',
        name: 'ຄືນເງິນລູກຄ້າ',
        emoji: '↩️',
        title: 'ຄືນເງິນລູກຄ້າ',
        subtitle: 'ໂອນຄືນຜ່ານ portal ຂອງ PhaJay ແລ້ວບັນທຶກທີ່ນີ້',
        roles: ['super_admin', 'finance'],
      },
    ],
  },
  {
    key: 'content',
    name: 'ເນື້ອຫາ & ການຕະຫຼາດ',
    items: [
      {
        to: '/content/banners',
        width: 'medium',
        name: 'ແບນເນີ',
        emoji: '🖼',
        title: 'ແບນເນີໜ້າຫຼັກ',
        subtitle: 'ຮູບໂປຣໂມຊັນເທິງສຸດຂອງແອັບລູກຄ້າ',
      },
      {
        to: '/content/announcements',
        width: 'medium',
        name: 'ປະກາດ',
        emoji: '📢',
        title: 'ປະກາດ',
        subtitle: 'ຂໍ້ຄວາມແຈ້ງເຖິງລູກຄ້າ ຫຼື Partner',
      },
      {
        to: '/content/faqs',
        width: 'medium',
        name: 'ຄຳຖາມທີ່ພົບເລື້ອຍ',
        emoji: '❓',
        title: 'ຄຳຖາມທີ່ພົບເລື້ອຍ · FAQ',
        subtitle: 'ຄຳຖາມ-ຄຳຕອບໃນໜ້າຊ່ວຍເຫຼືອ',
      },
      {
        to: '/content/pages',
        width: 'medium',
        name: 'ໜ້າຄົງທີ່',
        emoji: '📄',
        title: 'ໜ້າຄົງທີ່',
        subtitle: 'ເງື່ອນໄຂການໃຊ້ງານ, ນະໂຍບາຍ ແລະ ໜ້າກ່ຽວກັບ',
      },
      {
        to: '/promos',
        name: 'ໂຄ້ດສ່ວນຫຼຸດ',
        emoji: '🎟️',
        title: 'ໂຄ້ດສ່ວນຫຼຸດ',
        subtitle: 'ຈັດການໂຄ້ດສ່ວນຫຼຸດ & ໂປຣໂມຊັນ',
      },
    ],
  },
  {
    key: 'settings',
    name: 'ຕັ້ງຄ່າລະບົບ',
    items: [
      {
        to: '/settings/platform',
        width: 'narrow',
        name: 'ຂໍ້ມູນລະບົບ',
        emoji: '🏷',
        title: 'ຂໍ້ມູນລະບົບ',
        subtitle: 'ຊື່ແພລດຟອມ ແລະ ຊ່ອງທາງຕິດຕໍ່ທີ່ລູກຄ້າເຫັນ',
      },
      {
        to: '/settings/fees',
        width: 'narrow',
        name: 'ຄ່າຄອມມິຊຊັນ',
        emoji: '💵',
        title: 'ຄ່າຄອມມິຊຊັນ & ການເງິນ',
        subtitle: 'ອັດຕາທີ່ໃຊ້ຄິດທຸກການຈອງ',
      },
      {
        to: '/settings/operations',
        width: 'narrow',
        name: 'ການດຳເນີນງານ',
        emoji: '⏱',
        title: 'ການດຳເນີນງານ',
        subtitle: 'ເວລາກັນຫ້ອງ, ອາຍຸ QR, ຮອບໂອນເງິນ ແລະ ການລັອກບັນຊີ',
      },
      {
        to: '/settings/admins',
        width: 'narrow',
        name: 'ຜູ້ດູແລລະບົບ',
        emoji: '👤',
        title: 'ຜູ້ດູແລລະບົບ',
        subtitle: 'ບັນຊີພະນັກງານ ແລະ ສິດຂອງແຕ່ລະຄົນ',
      },
      {
        to: '/settings/audit',
        name: 'Audit log',
        emoji: '📋',
        title: 'ບັນທຶກການກະທຳ · Audit log',
        subtitle: 'ທຸກການກະທຳສຳຄັນຖືກບັນທຶກພ້ອມ IP ຜູ້ກະທຳ',
      },
    ],
  },
];

/** Flat, for looking up the header title of whatever route is showing. */
export const NAV: NavItem[] = [DASHBOARD, ...NAV_GROUPS.flatMap((g) => g.items)];

export function Shell() {
  const { admin, signOut, can } = useAuth();
  const location = useLocation();

  // Only meaningful below 1024px, where the sidebar is a drawer. Above it the
  // CSS ignores the flag entirely, so there is nothing to keep in sync.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Tapping a destination should take you there and get out of the way.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  // A drawer that survives Escape is a trap on a phone.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Drives the badge on "ອະນຸມັດ Partner" so it always reflects reality. The
  // endpoint returns one key per partner_status, so a run with nothing pending
  // omits "pending" entirely rather than sending a zero.
  const { data: counts } = useQuery({
    queryKey: ['approvals', 'counts'],
    queryFn: () => api.get<Partial<Record<string, number>>>('/admin/approvals/counts'),
    refetchInterval: 60_000,
  });

  // Guests waiting on money nobody has sent yet. Only finance can act on it,
  // so only finance is asked for the number.
  const { data: refundCounts } = useQuery({
    queryKey: ['refunds', 'counts'],
    queryFn: () =>
      api.get<Partial<Record<string, { count: number }>>>('/admin/refunds/counts'),
    enabled: can('super_admin', 'finance'),
    refetchInterval: 60_000,
  });

  const allowed = (item: NavItem) =>
    !item.roles || (admin?.adminRole ? item.roles.includes(admin.adminRole) : false);

  // A group whose every entry is hidden by role is not an empty heading — it
  // is not there at all.
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter(
    (g) => g.items.length > 0,
  );

  const current = [...NAV].reverse().find((n) => matches(location.pathname, n.to)) ?? NAV[0];
  const column = `adm-column${current.width ? ' adm-' + current.width : ''}`;

  // Groups start closed except the one holding the current page, and stay
  // however the admin leaves them afterwards.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      NAV_GROUPS.map((g) => [g.key, g.items.some((i) => matches(location.pathname, i.to))]),
    ),
  );

  // Following a link into a closed group — from a dashboard shortcut, or a
  // reload — must reveal where you now are.
  useEffect(() => {
    const holding = NAV_GROUPS.find((g) => g.items.some((i) => matches(location.pathname, i.to)));
    if (holding) setOpenGroups((o) => (o[holding.key] ? o : { ...o, [holding.key]: true }));
  }, [location.pathname]);

  // With every group open the list is taller than the window, so the entry you
  // just landed on can be below the fold. Waits a frame: the group above has to
  // expand before there is anything to scroll to.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document
        .querySelector('nav a[aria-current="page"]')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, openGroups]);

  return (
    // Full bleed, not a card on a page. The sidebar runs the whole height of
    // the window and stays there while the content scrolls under it — an admin
    // spends all day in this frame, and a floating panel with a margin around
    // it wastes the screen they are working on.
    <div
      className="adm-shell"
      style={{ background: c.bg, fontFamily: "'Noto Sans Lao', sans-serif" }}
    >
      {/* Below the breakpoint the drawer floats over the page, so it needs
          something to close against. */}
      {drawerOpen && <div className="adm-scrim" onClick={() => setDrawerOpen(false)} />}

      {/* ── sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="adm-sidebar"
        data-open={drawerOpen}
        style={{ background: `linear-gradient(160deg, ${c.sidebarFrom}, ${c.sidebarTo})` }}
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

        {/* Scrolls on its own if the window is short — the account footer
            below must stay reachable. */}
        <nav
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            flex: 1,
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          <NavRow item={DASHBOARD} badge={0} />

          {groups.map((group) => {
            const open = !!openGroups[group.key];
            // What the heading must still say while it is closed.
            const hidden = open
              ? 0
              : group.items.reduce((n, i) => n + badgeFor(i, counts, refundCounts), 0);

            return (
              <div key={group.key}>
                <button
                  onClick={() => setOpenGroups((o) => ({ ...o, [group.key]: !o[group.key] }))}
                  aria-expanded={open}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '11px 12px',
                    marginTop: 6,
                    borderRadius: radius.md,
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    // No `text-transform: uppercase` — Lao script has no case,
                    // so it would shout the Latin words and leave the rest,
                    // giving "PARTNER & ການເງິນ".
                    font: f(700, 11.5),
                    letterSpacing: 0.3,
                    color: c.onDarkSoft,
                    textAlign: 'left',
                  }}
                >
                  <span style={{ flex: 1 }}>{group.name}</span>
                  {!!hidden && <Badge count={hidden} active={false} />}
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}
                  >
                    <path
                      d="M6 9l6 6 6-6"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {group.items.map((item) => (
                      <NavRow
                        key={item.to}
                        item={item}
                        badge={badgeFor(item, counts, refundCounts)}
                        indent
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
            {initials(admin?.fullName ?? admin?.email ?? '?')}
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
              {admin?.fullName ?? admin?.email}
            </div>
            <div style={{ font: f(400, 10), color: c.onDarkSoft }}>
              {admin?.adminRole ? ROLE_LABEL[admin.adminRole] : '—'}
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
      {/* The page itself scrolls — no inner scroll box. Two nested scrollbars
          in one screen is the thing that makes an admin panel feel like a
          widget rather than an application. */}
      <main className="adm-main" style={{ background: c.bg }}>
        <header
          className="adm-header"
          style={{ background: c.bg, borderBottom: `1px solid ${c.border}` }}
        >
          <div className={column}>
          <button
            className="adm-burger"
            aria-label="ເປີດເມນູ"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke={c.text}
                strokeWidth="1.9"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                font: f(800, 22),
                color: c.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {current.title}
            </div>
            <div style={{ font: f(400, 13), color: c.muted, marginTop: 2 }}>{current.subtitle}</div>
          </div>
          </div>
        </header>

        <div className="adm-content">
          <div className={column}>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}

function matches(pathname: string, to: string): boolean {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(to + '/');
}

/**
 * The number an entry carries, or zero.
 *
 * Only approvals has one today. It lives in a function rather than inline so
 * that a closed group can sum what it is hiding without the rendering code
 * knowing which entries have counts.
 */
function badgeFor(
  item: NavItem,
  counts: Partial<Record<string, number>> | undefined,
  refunds: Partial<Record<string, { count: number }>> | undefined,
): number {
  if (item.to === '/approvals') return counts?.pending ?? 0;
  if (item.to === '/refunds') return refunds?.pending?.count ?? 0;
  return 0;
}

function Badge({ count, active }: { count: number; active: boolean }) {
  return (
    <span
      style={{
        minWidth: 20,
        height: 20,
        padding: '0 6px',
        borderRadius: 10,
        background: active ? '#fff' : c.accent,
        color: active ? c.accent : '#fff',
        font: f(700, 11),
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
      }}
    >
      {count}
    </span>
  );
}

function NavRow({
  item,
  badge,
  indent,
}: {
  item: NavItem;
  badge: number;
  indent?: boolean;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '11px 12px',
        paddingLeft: indent ? 22 : 12,
        borderRadius: radius.md,
        font: f(600, 13),
        textDecoration: 'none',
        background: isActive ? c.accent : 'transparent',
        color: isActive ? '#fff' : c.onDark,
        transition: 'background .15s',
      })}
    >
      {({ isActive }) => (
        <>
          <span style={{ fontSize: 15, width: 18, textAlign: 'center', flex: 'none' }}>
            {item.emoji}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>{item.name}</span>
          {!!badge && <Badge count={badge} active={isActive} />}
        </>
      )}
    </NavLink>
  );
}
