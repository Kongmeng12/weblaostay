import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { laoAgo } from '../lib/format';
import type { AdminNotification, AdminNotificationFeed } from '../lib/types';
import { c, f, radius } from '../theme';

/**
 * Where each `referenceType` opens — the admin's side of the same taxonomy the
 * guest and host apps read. Each lands on the screen where the work is done,
 * not a page about the notification.
 */
function targetFor(n: AdminNotification): string | null {
  switch (n.referenceType) {
    case 'partner':
      return '/approvals';
    case 'refund':
      return '/refunds';
    case 'review':
      // The "ລໍກວດ" tab is where a hide request is settled.
      return '/reviews?filter=awaiting';
    case 'booking':
      return n.referenceId ? `/bookings?open=${n.referenceId}` : '/bookings';
    default:
      return null;
  }
}

const TYPE_ICON: Record<string, string> = {
  booking: '🧾',
  payment: '↩️',
  review: '🚩',
  system: '🤝',
  promo: '🎟️',
};

/** The bell in the header, with its dropdown. */
export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const feed = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: () => api.get<AdminNotificationFeed>('/admin/notifications'),
    // Faster than the sidebar badges: this is where new work shows up first.
    // Also on returning to the tab — an admin coming back after a while should
    // not wait for the next tick to see what arrived.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-notifications'] });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/admin/notifications/${id}/read`),
    onSuccess: refresh,
  });

  const readAll = useMutation({
    mutationFn: () => api.post('/admin/notifications/read-all'),
    onSuccess: refresh,
  });

  // Closes on a click anywhere else, and on Escape — a panel that stays open
  // over the page is in the way of the work it just pointed at.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openItem(n: AdminNotification) {
    if (!n.isRead) markRead.mutate(n.id);
    const target = targetFor(n);
    setOpen(false);
    if (target) navigate(target);
  }

  const unread = feed.data?.unread ?? 0;
  const items = feed.data?.items ?? [];

  return (
    <div ref={wrap} style={{ position: 'relative', marginLeft: 'auto', flex: 'none' }}>
      <button
        aria-label="ແຈ້ງເຕືອນ"
        aria-expanded={open}
        onClick={() => {
          if (!open) refresh();
          setOpen((o) => !o);
        }}
        style={{
          position: 'relative',
          width: 40,
          height: 40,
          display: 'grid',
          placeItems: 'center',
          borderRadius: radius.md,
          border: `1px solid ${open ? c.accent : c.border}`,
          background: c.surface,
          color: open ? c.accent : c.soft,
          cursor: 'pointer',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path
            d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -6,
              right: -6,
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 9,
              background: c.accent,
              color: '#fff',
              font: f(700, 10.5),
              display: 'grid',
              placeItems: 'center',
              border: `2px solid ${c.bg}`,
            }}
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="ແຈ້ງເຕືອນ"
          style={{
            position: 'absolute',
            top: 48,
            right: 0,
            width: 'min(380px, calc(100vw - 28px))',
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: radius.lg,
            boxShadow: '0 18px 40px rgba(43,37,33,.14)',
            overflow: 'hidden',
            zIndex: 30,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: `1px solid ${c.divider}`,
            }}
          >
            <span style={{ font: f(700, 14), color: c.text }}>ແຈ້ງເຕືອນ</span>
            {unread > 0 && (
              <button
                onClick={() => readAll.mutate()}
                disabled={readAll.isPending}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: f(600, 12),
                  color: c.accent,
                  cursor: 'pointer',
                }}
              >
                ອ່ານທັງໝົດ
              </button>
            )}
          </div>

          <div style={{ maxHeight: 440, overflowY: 'auto' }}>
            {feed.isLoading ? (
              <div style={{ padding: 20, font: f(400, 13), color: c.muted }}>ກຳລັງໂຫຼດ...</div>
            ) : feed.isError ? (
              <div style={{ padding: 20, font: f(500, 13), color: c.dangerFg }}>
                ໂຫຼດແຈ້ງເຕືອນບໍ່ໄດ້
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: '28px 20px', textAlign: 'center', font: f(400, 13), color: c.muted }}>
                ຍັງບໍ່ມີແຈ້ງເຕືອນ
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                    padding: '12px 16px',
                    textAlign: 'left',
                    background: n.isRead ? c.surface : '#FFF8F3',
                    border: 'none',
                    borderBottom: `1px solid ${c.divider}`,
                    cursor: targetFor(n) ? 'pointer' : 'default',
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      flex: 'none',
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: '50%',
                      background: n.isRead ? c.bg : c.accentSoft,
                      fontSize: 15,
                    }}
                  >
                    {TYPE_ICON[n.type] ?? '🔔'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          flex: 1,
                          font: f(n.isRead ? 600 : 700, 13),
                          color: c.text,
                        }}
                      >
                        {n.title}
                      </span>
                      {!n.isRead && (
                        <span
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: c.accent,
                            flex: 'none',
                          }}
                        />
                      )}
                    </span>
                    {n.message && (
                      <span
                        style={{
                          display: 'block',
                          marginTop: 2,
                          font: f(400, 12, 18),
                          color: c.soft,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {n.message}
                      </span>
                    )}
                    <span style={{ display: 'block', marginTop: 3, font: f(400, 11), color: c.faint }}>
                      {laoAgo(n.createdAt)}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
