import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { c, radius, type as t } from '../theme';
import { laoAgo } from '../lib/format';
import { Button, Empty, ErrorNote, Page, PageTitle, Skeleton } from '../components/ui';
import type { AppNotification, NotificationFeed } from '../lib/types';

/// Where each `referenceType` opens — the same taxonomy the Flutter apps'
/// notification screens read off the same backend feed.
function targetFor(n: AppNotification): string | null {
  switch (n.referenceType) {
    case 'booking':
      return n.referenceId ? `/trips/${n.referenceId}` : null;
    case 'conversation':
      return n.referenceId ? `/messages/${n.referenceId}` : null;
    case 'property':
      // A review reply has no page of its own — this opens the property's
      // reviews tab, where the guest sees it in context.
      return n.referenceId ? `/property/${n.referenceId}#reviews` : null;
    default:
      return null;
  }
}

const TYPE_ICON: Record<string, string> = {
  booking: '🧾',
  payment: '💳',
  promo: '🎟️',
  review: '⭐',
  system: '🔔',
};

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationFeed>('/customer/notifications'),
  });

  const readAll = useMutation({
    mutationFn: () => api.post('/customer/notifications/read-all'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/customer/notifications/${id}/read`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function open(n: AppNotification) {
    if (!n.isRead) markRead.mutate(n.id);
    const target = targetFor(n);
    if (target) navigate(target);
  }

  return (
    <Page width="narrow">
      <PageTitle
        right={
          !!query.data?.unread && (
            <Button variant="outline" onClick={() => readAll.mutate()} disabled={readAll.isPending}>
              ໝາຍວ່າອ່ານແລ້ວທັງໝົດ
            </Button>
          )
        }
      >
        ແຈ້ງເຕືອນ
      </PageTitle>

      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}

      {query.isLoading ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={74} />
          ))}
        </div>
      ) : query.data?.items.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {query.data.items.map((n) => (
            <div
              key={n.id}
              onClick={() => open(n)}
              style={{
                display: 'flex',
                gap: 13,
                padding: 15,
                background: n.isRead ? c.surface : c.accentSoft,
                border: `1px solid ${n.isRead ? c.border : '#F8C9B4'}`,
                borderRadius: radius.lg,
                cursor: targetFor(n) ? 'pointer' : 'default',
              }}
            >
              <span style={{ fontSize: 19, flex: 'none' }}>{TYPE_ICON[n.type] ?? '🔔'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: t.bodySm, color: c.text, marginBottom: 3 }}>{n.title}</div>
                {n.message && (
                  <div style={{ font: t.caption, color: c.soft }}>{n.message}</div>
                )}
                <div style={{ font: t.caption, color: c.faint, marginTop: 5 }}>
                  {laoAgo(n.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon="🔔"
          message="ຍັງບໍ່ມີແຈ້ງເຕືອນ"
          hint="ເມື່ອຈອງ ຫຼື ຊຳລະສຳເລັດ ເຮົາຈະແຈ້ງໃຫ້ທ່ານຢູ່ນີ້"
        />
      )}
    </Page>
  );
}
