import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import {
  c,
  f,
  radius,
  MAX_WIDTH,
  BOOKING_STATUS_PILL,
  PAYMENT_STATUS_PILL,
  pillFor,
} from '../theme';
import { countdown, kip, laoDateFull, laoDateTime } from '../lib/format';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Loading,
  Modal,
  MoneyRow,
  Pill,
  Spinner,
  inputStyle,
} from '../components/ui';
import type { BookingDetail, CancelResult } from '../lib/types';
import { useStartConversation } from './Messages';

/** `refund_status` — what stage the money is at on its way back. */
const REFUND_STATUS_LABEL: Record<string, string> = {
  pending: 'ລໍດຳເນີນການ',
  processing: 'ກຳລັງໂອນຄືນ',
  completed: 'ຄືນສຳເລັດ',
  failed: 'ລົ້ມເຫຼວ',
};

export function TripDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const startChat = useStartConversation();
  const [cancelling, setCancelling] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const query = useQuery({
    queryKey: ['booking', id],
    queryFn: () => api.get<BookingDetail>(`/customer/bookings/${id}`),
  });

  if (query.isLoading) return <Loading />;
  if (query.isError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const b = query.data!;
  const pill = pillFor(BOOKING_STATUS_PILL, b.status);
  const remaining = b.status === 'pending' ? countdown(b.holdExpiresAt) : null;

  // The API refuses to cancel a stay that is over or already cancelled, so the
  // button is not offered for those. A stay in progress is the property's call.
  const canCancel = !['cancelled', 'completed', 'no_show', 'staying'].includes(b.status);

  return (
    <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto', padding: '28px 18px 48px' }}>
      <Link to="/trips" style={{ font: f(600, 13), color: c.muted }}>
        ← ການເດີນທາງທັງໝົດ
      </Link>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          margin: '14px 0 20px',
        }}
      >
        <h1 style={{ font: f(800, 24), color: c.text, margin: 0 }}>{b.code}</h1>
        <Pill bg={pill.bg} fg={pill.fg}>
          {pill.label}
        </Pill>
        {b.source === 'walk_in' && (
          <Pill bg={c.infoBg} fg={c.infoFg}>
            ຈອງທີ່ໜ້າຮ້ານ
          </Pill>
        )}
      </div>

      {b.status === 'pending' && (
        <div
          style={{
            background: c.warnBg,
            border: '1px solid #E8D4A8',
            borderRadius: radius.md,
            padding: '14px 16px',
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ font: f(600, 13, 20), color: c.warnFg }}>
            {remaining
              ? `ຍັງບໍ່ໄດ້ຊຳລະ — ຫ້ອງກັນໄວ້ໃຫ້ອີກ ${remaining}`
              : 'ໝົດເວລາກັນຫ້ອງແລ້ວ — ຫ້ອງອາດຖືກປ່ອຍຄືນ'}
          </span>
          <Button onClick={() => navigate(`/pay/${b.id}`)}>ໄປໜ້າຈ່າຍ</Button>
        </div>
      )}

      <div className="laostay-split">
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ font: f(800, 15), color: c.text, marginBottom: 12 }}>ທີ່ພັກ</div>
            <Row label="ຊື່" value={b.property.name} />
            <Row
              label="ທີ່ຢູ່"
              value={
                [b.property.district, b.property.province, b.property.address]
                  .filter(Boolean)
                  .join(' · ') || '—'
              }
            />
            <Row label="ຫ້ອງ" value={b.roomType?.name ?? '—'} />
            {b.roomType && b.roomType.quantity > 1 && (
              <Row label="ຈຳນວນຫ້ອງ" value={`${b.roomType.quantity} ຫ້ອງ`} />
            )}
            <Row label="ເຈົ້າຂອງ" value={b.property.host} />
            {b.property.phone && (
              <Row
                label="ຕິດຕໍ່"
                value={b.property.phone}
                href={`tel:${b.property.phone.replace(/\s/g, '')}`}
              />
            )}
            <div style={{ marginTop: 12 }}>
              <Link to={`/property/${b.property.id}`} style={{ font: f(600, 12.5) }}>
                ເບິ່ງໜ້າທີ່ພັກ →
              </Link>
            </div>
          </Card>

          <Card>
            <div style={{ font: f(800, 15), color: c.text, marginBottom: 12 }}>ການເຂົ້າພັກ</div>
            <Row label="ເຂົ້າພັກ" value={laoDateFull(b.checkIn)} />
            <Row label="ອອກ" value={laoDateFull(b.checkOut)} />
            <Row label="ຈຳນວນຄືນ" value={`${b.nights} ຄືນ`} />
            <Row label="ຜູ້ເຂົ້າພັກ" value={`${b.guests} ຄົນ`} />
            <Row label="ວັນຈອງ" value={laoDateTime(b.createdAt)} />
            {b.specialRequest && <Row label="ຄຳຂໍພິເສດ" value={b.specialRequest} />}
          </Card>

          {b.payments.length > 0 && (
            <Card>
              <div style={{ font: f(800, 15), color: c.text, marginBottom: 12 }}>ການຊຳລະ</div>
              {b.payments.map((p) => {
                const pp = pillFor(PAYMENT_STATUS_PILL, p.status);
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 14,
                      padding: '8px 0',
                      borderBottom: `1px solid ${c.divider}`,
                    }}
                  >
                    <div>
                      <Pill bg={pp.bg} fg={pp.fg}>
                        {pp.label}
                      </Pill>
                      <div style={{ font: f(400, 11.5), color: c.faint, marginTop: 5 }}>
                        {p.paidAt ? laoDateTime(p.paidAt) : 'ຍັງບໍ່ຈ່າຍ'}
                      </div>
                    </div>
                    <span style={{ font: f(700, 14), color: c.text }}>{kip(p.amount)}</span>
                  </div>
                );
              })}
            </Card>
          )}
        </div>

        <div className="laostay-aside" style={{ position: 'sticky', top: 84, display: 'grid', gap: 14 }}>
          <Card>
            <div style={{ font: f(800, 15), color: c.text, marginBottom: 12 }}>ຍອດເງິນ</div>
            <MoneyRow label="ຄ່າຫ້ອງ" amount={kip(b.subtotal)} />
            {b.serviceFee > 0 && <MoneyRow label="ຄ່າບໍລິການ" amount={kip(b.serviceFee)} />}
            {b.tax > 0 && <MoneyRow label="ພາສີ" amount={kip(b.tax)} />}
            {b.cleaningFee > 0 && <MoneyRow label="ຄ່າທຳຄວາມສະອາດ" amount={kip(b.cleaningFee)} />}
            {b.discount > 0 && <MoneyRow label="ສ່ວນຫຼຸດ" amount={kip(b.discount)} negative />}
            <div style={{ borderTop: `1px solid ${c.divider}`, margin: '8px 0' }} />
            <MoneyRow label="ລວມທັງໝົດ" amount={kip(b.total)} strong />
            {b.paidAmount > 0 && <MoneyRow label="ຈ່າຍແລ້ວ" amount={kip(b.paidAmount)} />}

            {/* A guest who cancelled wants one number: what comes back. But it
                only makes sense next to what they paid — and `paidAmount` is
                zero once a refund flips the payment off `paid`, so the figure
                comes from the split instead. The server derives the refund by
                subtraction, so penalty + refund is exactly what was captured. */}
            {b.cancellation && (
              <>
                <div style={{ borderTop: `1px solid ${c.divider}`, margin: '8px 0' }} />
                <MoneyRow
                  label="ຈ່າຍມາ"
                  amount={kip(b.cancellation.penalty + b.cancellation.refund)}
                />
                <MoneyRow label="ຄ່າທຳນຽມຍົກເລີກ" amount={kip(b.cancellation.penalty)} />
                {/* The same wording as the cancel dialog, so the number the
                    guest was promised is the number they come back to. */}
                <MoneyRow
                  label="ຈະຄືນເງິນໃຫ້ທ່ານ"
                  amount={kip(b.cancellation.refund)}
                  strong
                />
              </>
            )}
          </Card>

          {b.cancellation && (
            <Card>
              <div style={{ font: f(800, 15), color: c.text, marginBottom: 10 }}>ການຍົກເລີກ</div>
              {b.cancellation.reason && (
                <Row label="ເຫດຜົນ" value={b.cancellation.reason} />
              )}
              <Row label="ຍົກເລີກເມື່ອ" value={laoDateTime(b.cancellation.cancelledAt)} />
              {b.refunds.map((r) => (
                <Row
                  key={r.id}
                  label="ສະຖານະການຄືນເງິນ"
                  value={`${REFUND_STATUS_LABEL[r.status] ?? r.status} · ${kip(r.amount)}`}
                />
              ))}
              <p style={{ font: f(400, 12, 19), color: c.muted, margin: '10px 0 0' }}>
                ເງິນຈະຄືນເຂົ້າບັນຊີເດີມພາຍໃນ 3–7 ວັນລັດຖະການ
              </p>
            </Card>
          )}

          <Button
            variant="outline"
            full
            disabled={startChat.isPending}
            onClick={() => startChat.mutate({ propertyId: b.property.id, bookingId: b.id })}
          >
            💬 ຖາມທີ່ພັກ
          </Button>

          {canCancel && (
            <Button variant="danger" full onClick={() => setCancelling(true)}>
              ຍົກເລີກການຈອງ
            </Button>
          )}

          {b.status === 'completed' && (
            <Button full onClick={() => setReviewing(true)}>
              ຂຽນຮີວິວ
            </Button>
          )}
        </div>
      </div>

      {cancelling && (
        <CancelDialog
          booking={b}
          onClose={() => setCancelling(false)}
          onDone={() => {
            setCancelling(false);
            void queryClient.invalidateQueries({ queryKey: ['booking', b.id] });
            void queryClient.invalidateQueries({ queryKey: ['trips'] });
          }}
        />
      )}

      {reviewing && (
        <ReviewDialog
          bookingId={b.id}
          onClose={() => setReviewing(false)}
          onDone={() => {
            setReviewing(false);
            void queryClient.invalidateQueries({ queryKey: ['trips'] });
          }}
        />
      )}
    </div>
  );
}

/**
 * Cancelling.
 *
 * The penalty comes from the property's own cancellation policy and is worked
 * out server-side, so the dialog does not promise a refund figure it cannot
 * guarantee — it reports the real one afterwards.
 */
function CancelDialog({
  booking,
  onClose,
  onDone,
}: {
  booking: BookingDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<CancelResult | null>(null);

  const cancel = useMutation({
    mutationFn: () =>
      api.post<CancelResult>(`/customer/bookings/${booking.id}/cancel`, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: setResult,
  });

  if (result) {
    return (
      <Modal
        title="ຍົກເລີກແລ້ວ"
        onClose={onDone}
        footer={<Button onClick={onDone}>ຮັບຊາບ</Button>}
      >
        <MoneyRow label="ຈ່າຍມາ" amount={kip(result.paid)} />
        <MoneyRow label="ຄ່າທຳນຽມຍົກເລີກ" amount={kip(result.penalty)} />
        <div style={{ borderTop: `1px solid ${c.divider}`, margin: '8px 0' }} />
        <MoneyRow label="ຈະຄືນເງິນໃຫ້ທ່ານ" amount={kip(result.refund)} strong />
        <p style={{ font: f(400, 12.5, 20), color: c.muted, marginTop: 14 }}>
          ເງິນຈະຄືນເຂົ້າບັນຊີເດີມພາຍໃນ 3–7 ວັນລັດຖະການ
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title={`ຍົກເລີກການຈອງ ${booking.code}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            ບໍ່ຍົກເລີກ
          </Button>
          <Button variant="danger" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
            {cancel.isPending ? <Spinner size={15} color={c.dangerFg} /> : 'ຢືນຢັນຍົກເລີກ'}
          </Button>
        </>
      }
    >
      <p style={{ font: f(400, 13.5, 22), color: c.soft, margin: '0 0 16px' }}>
        ຄ່າທຳນຽມຈະຄິດຕາມນະໂຍບາຍຂອງທີ່ພັກ ແລະ ສ່ວນທີ່ເຫຼືອຈະຄືນໃຫ້ທ່ານ.
        ຫ້ອງຈະຖືກປ່ອຍໃຫ້ຄົນອື່ນຈອງໄດ້ທັນທີ.
      </p>

      <Field label="ເຫດຜົນ (ບໍ່ບັງຄັບ)">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ເຊັ່ນ: ປ່ຽນແຜນການເດີນທາງ"
          maxLength={255}
          style={inputStyle}
        />
      </Field>

      {cancel.isError && (
        <div style={{ marginTop: 14 }}>
          <ErrorNote error={cancel.error} />
        </div>
      )}
    </Modal>
  );
}

function ReviewDialog({
  bookingId,
  onClose,
  onDone,
}: {
  bookingId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [starsGiven, setStars] = useState(5);
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/customer/bookings/${bookingId}/review`, {
        stars: starsGiven,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      }),
    onSuccess: onDone,
  });

  return (
    <Modal
      title="ຂຽນຮີວິວ"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submit.isPending}>
            ຍົກເລີກ
          </Button>
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {submit.isPending ? <Spinner size={15} color="#fff" /> : 'ສົ່ງຮີວິວ'}
          </Button>
        </>
      }
    >
      <div style={{ marginBottom: 18 }}>
        <span style={{ font: f(700, 12.5), color: c.text, display: 'block', marginBottom: 8 }}>
          ໃຫ້ຄະແນນ
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setStars(n)}
              aria-label={`${n} ດາວ`}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 30,
                lineHeight: 1,
                cursor: 'pointer',
                color: n <= starsGiven ? c.star : c.neutralBg,
                padding: 0,
              }}
            >
              ★
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="ຫົວຂໍ້ (ບໍ່ບັງຄັບ)">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            placeholder="ເຊັ່ນ: ສະອາດ ພະນັກງານດີ"
            style={inputStyle}
          />
        </Field>

        <Field label="ຂໍ້ຄວາມ (ບໍ່ບັງຄັບ)">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            maxLength={2000}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>
      </div>

      {submit.isError && (
        <div style={{ marginTop: 14 }}>
          <ErrorNote error={submit.error} />
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '4px 0' }}>
      <span style={{ font: f(400, 13), color: c.muted, flex: 'none' }}>{label}</span>
      {href ? (
        <a href={href} style={{ font: f(600, 13), textAlign: 'right' }}>
          {value}
        </a>
      ) : (
        <span style={{ font: f(600, 13), color: c.text, textAlign: 'right' }}>{value}</span>
      )}
    </div>
  );
}
