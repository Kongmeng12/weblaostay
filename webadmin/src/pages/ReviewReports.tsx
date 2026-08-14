import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ReportStatus, ReviewReportRow } from '../lib/types';
import { c, f, radius, pillFor, REPORT_REASON_PILL, REPORT_STATUS_PILL } from '../theme';
import { laoAgo } from '../lib/format';
import { Button, Card, Chips, EmptyState, ErrorState, Pill } from '../components/ui';

type Filter = ReportStatus;

/**
 * Reviews somebody has complained about.
 *
 * Settling a report does not touch the review. Upholding a complaint and hiding
 * a review are two separate, separately audited decisions — otherwise a host
 * who dislikes a fair review could get it removed by complaining, and the log
 * would show only that a report was "handled".
 */
export function ReviewReports() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('pending');

  const counts = useQuery({
    queryKey: ['review-reports', 'counts'],
    queryFn: () => api.get<Partial<Record<ReportStatus, number>>>('/admin/review-reports/counts'),
    refetchInterval: 60_000,
  });

  const list = useQuery({
    queryKey: ['review-reports', filter],
    queryFn: () => api.get<ReviewReportRow[]>(`/admin/review-reports?status=${filter}`),
  });

  const handle = useMutation({
    mutationFn: (v: { id: string; status: ReportStatus }) =>
      api.patch(`/admin/review-reports/${v.id}`, { status: v.status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['review-reports'] });
      // The count beside each review on the Reviews page comes from the same
      // rows, so it goes stale the moment one is settled.
      void qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });

  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const rows = list.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Chips<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'pending', label: 'ລໍກວດ', count: counts.data?.pending },
          { value: 'reviewed', label: 'ຮັບເລື່ອງແລ້ວ', count: counts.data?.reviewed },
          { value: 'dismissed', label: 'ຍົກຟ້ອງ', count: counts.data?.dismissed },
        ]}
      />

      {list.isLoading ? (
        <Card padding={48}>
          <div style={{ font: f(500, 13), color: c.muted, textAlign: 'center' }}>ກຳລັງໂຫຼດ...</div>
        </Card>
      ) : rows.length === 0 ? (
        <Card padding={0}>
          <EmptyState message={filter === 'pending' ? 'ບໍ່ມີລາຍງານທີ່ຕ້ອງກວດ' : 'ບໍ່ມີລາຍການ'} />
        </Card>
      ) : (
        rows.map((r) => (
          <ReportCard
            key={r.id}
            report={r}
            busy={handle.isPending}
            onHandle={(status) => handle.mutate({ id: r.id, status })}
          />
        ))
      )}
    </div>
  );
}

/**
 * One complaint, with the review it is about.
 *
 * A card rather than a table row: deciding needs the review's actual text, and
 * a moderator cannot judge "offensive" from a truncated cell.
 */
function ReportCard({
  report,
  busy,
  onHandle,
}: {
  report: ReviewReportRow;
  busy: boolean;
  onHandle: (status: ReportStatus) => void;
}) {
  const reason = pillFor(REPORT_REASON_PILL, report.reason);
  const status = pillFor(REPORT_STATUS_PILL, report.status);

  return (
    <Card padding={20}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Pill bg={reason.bg} fg={reason.fg}>
          {reason.label}
        </Pill>
        <Pill bg={status.bg} fg={status.fg}>
          {status.label}
        </Pill>
        <span style={{ font: f(400, 12), color: c.faint }}>
          ລາຍງານໂດຍ <b style={{ color: c.soft }}>{report.reportedBy}</b>
          {report.reportedByRole === 'PARTNER' && ' (ເຈົ້າຂອງທີ່ພັກ)'} · {laoAgo(report.createdAt)}
        </span>
      </div>

      {report.detail && (
        <p style={{ font: f(400, 13, 21), color: c.text, margin: '12px 0 0' }}>{report.detail}</p>
      )}

      {/* The review itself, set apart so it is never mistaken for the complaint. */}
      <div
        style={{
          background: c.bg,
          borderRadius: radius.md,
          padding: 14,
          marginTop: 14,
          borderLeft: `3px solid ${c.border}`,
        }}
      >
        <div style={{ font: f(400, 11.5), color: c.faint }}>
          {report.property} · {report.guest} · {'★'.repeat(Math.round(report.stars))}
          {report.reviewStatus !== 'published' && ` · ${report.reviewStatus}`}
        </div>
        {report.title && (
          <div style={{ font: f(700, 13.5), color: c.text, marginTop: 6 }}>{report.title}</div>
        )}
        {report.comment && (
          <p style={{ font: f(400, 13, 20), color: c.soft, margin: '4px 0 0' }}>{report.comment}</p>
        )}
      </div>

      {report.status === 'pending' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <Button size="sm" disabled={busy} onClick={() => onHandle('reviewed')}>
            ຮັບເລື່ອງ
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onHandle('dismissed')}>
            ຍົກຟ້ອງ
          </Button>
          {/* Hiding is a separate decision on the Reviews page, and logs
              separately. Settling the complaint does not silence anyone. */}
          <span style={{ font: f(400, 11.5, 18), color: c.faint, alignSelf: 'center' }}>
            ເຊື່ອງຮີວິວເຮັດຢູ່ໜ້າ ຮີວິວ ຕ່າງຫາກ
          </span>
        </div>
      )}
    </Card>
  );
}
