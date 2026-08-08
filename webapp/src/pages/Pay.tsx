import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { c, f, radius, MAX_WIDTH } from '../theme';
import { countdown, kip, laoDateFull } from '../lib/format';
import { Button, Card, ErrorNote, Loading, MoneyRow, Spinner } from '../components/ui';
import { QrCode } from '../components/QrCode';
import type { BookingDetail, Payment } from '../lib/types';

/**
 * Pay for a held booking.
 *
 * Two clocks matter here and they are not the same. `hold_expires_at` is when
 * the sweeper releases the room; the QR's own `expiresAt` is when the bank
 * stops accepting that code. The guest is shown the hold, because that is the
 * one that loses them the room.
 */
export function PayPage() {
  const { bookingId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());

  const booking = useQuery({
    queryKey: ['booking', bookingId],
    queryFn: () => api.get<BookingDetail>(`/customer/bookings/${bookingId}`),
  });

  // Issuing a QR is idempotent server-side: a live one is returned rather than
  // replaced, so a refresh does not strand the code already open in a banking
  // app.
  const payment = useQuery({
    queryKey: ['payment', bookingId],
    queryFn: () => api.post<Payment>(`/customer/bookings/${bookingId}/pay`),
    enabled: booking.data?.status === 'pending',
    retry: false,
  });

  const paymentId = payment.data?.id;

  // Poll for settlement. The bank tells the server, not the browser, so this is
  // the only way the page learns the guest has paid.
  const status = useQuery({
    queryKey: ['payment-status', paymentId],
    queryFn: () => api.get<Payment>(`/customer/payments/${paymentId}`),
    enabled: !!paymentId && booking.data?.status === 'pending',
    refetchInterval: 4000,
  });

  const settled = status.data?.status === 'paid' || booking.data?.status === 'confirmed';

  useEffect(() => {
    if (!settled) return;
    void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
    const timer = setTimeout(() => navigate(`/trips/${bookingId}`, { replace: true }), 1600);
    return () => clearTimeout(timer);
  }, [settled, bookingId, navigate, queryClient]);

  // One tick a second drives the countdown.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (booking.isLoading) return <Loading />;
  if (booking.isError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorNote error={booking.error} onRetry={() => void booking.refetch()} />
      </div>
    );
  }

  const b = booking.data!;
  const remaining = countdown(b.holdExpiresAt);
  // `now` is read so the countdown recomputes each tick.
  void now;

  if (settled) {
    return (
      <Centre>
        <div style={{ fontSize: 46, marginBottom: 14 }}>✅</div>
        <h1 style={{ font: f(800, 24), color: c.text, margin: '0 0 8px' }}>ຊຳລະສຳເລັດ</h1>
        <p style={{ font: f(400, 14, 22), color: c.muted, margin: '0 0 22px' }}>
          ການຈອງ <b style={{ color: c.text }}>{b.code}</b> ຢືນຢັນແລ້ວ
        </p>
        <Spinner />
      </Centre>
    );
  }

  if (b.status === 'cancelled') {
    return (
      <Centre>
        <div style={{ fontSize: 46, marginBottom: 14 }}>⏳</div>
        <h1 style={{ font: f(800, 22), color: c.text, margin: '0 0 8px' }}>
          ໝົດເວລາກັນຫ້ອງແລ້ວ
        </h1>
        <p style={{ font: f(400, 14, 22), color: c.muted, margin: '0 0 22px', maxWidth: 380 }}>
          ການຈອງ {b.code} ຖືກຍົກເລີກ ເພາະບໍ່ໄດ້ຊຳລະພາຍໃນເວລາ — ຫ້ອງຖືກປ່ອຍຄືນໃຫ້ຄົນອື່ນແລ້ວ.
          ກະລຸນາຈອງໃໝ່ອີກຄັ້ງ.
        </p>
        <Button size="lg" onClick={() => navigate(`/property/${b.property.id}`)}>
          ຈອງໃໝ່
        </Button>
      </Centre>
    );
  }

  if (b.status !== 'pending') {
    return (
      <Centre>
        <h1 style={{ font: f(800, 22), color: c.text, margin: '0 0 8px' }}>
          ການຈອງນີ້ບໍ່ຕ້ອງຊຳລະແລ້ວ
        </h1>
        <Button size="lg" onClick={() => navigate(`/trips/${b.id}`)}>
          ເບິ່ງລາຍລະອຽດ
        </Button>
      </Centre>
    );
  }

  return (
    <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto', padding: '28px 18px 48px' }}>
      <h1 style={{ font: f(800, 24), color: c.text, margin: '0 0 6px' }}>ຊຳລະເງິນ</h1>
      <p style={{ font: f(400, 13.5), color: c.muted, margin: '0 0 22px' }}>
        ການຈອງ <b style={{ color: c.text }}>{b.code}</b> · {b.property.name}
      </p>

      <div className="laostay-split">
        <Card padding={24}>
          <div style={{ textAlign: 'center' }}>
            {remaining ? (
              <div
                style={{
                  display: 'inline-block',
                  background: c.warnBg,
                  color: c.warnFg,
                  padding: '8px 16px',
                  borderRadius: 999,
                  font: f(700, 13),
                  marginBottom: 18,
                }}
              >
                ກັນຫ້ອງໄວ້ອີກ {remaining}
              </div>
            ) : (
              <div
                style={{
                  display: 'inline-block',
                  background: c.dangerBg,
                  color: c.dangerFg,
                  padding: '8px 16px',
                  borderRadius: 999,
                  font: f(700, 13),
                  marginBottom: 18,
                }}
              >
                ໝົດເວລາກັນຫ້ອງ — ກຳລັງກວດສະຖານະ
              </div>
            )}

            {payment.isLoading ? (
              <Loading label="ກຳລັງສ້າງ QR..." />
            ) : payment.isError ? (
              <ErrorNote error={payment.error} onRetry={() => void payment.refetch()} />
            ) : payment.data?.qrPayload ? (
              <>
                <div
                  style={{
                    display: 'inline-block',
                    padding: 14,
                    background: '#fff',
                    border: `1px solid ${c.border}`,
                    borderRadius: radius.lg,
                  }}
                >
                  <QrCode value={payment.data.qrPayload} />
                </div>

                <div style={{ font: f(800, 22), color: c.accent, margin: '18px 0 4px' }}>
                  {kip(payment.data.amount)}
                </div>
                <div style={{ font: f(400, 13, 21), color: c.muted, maxWidth: 320, margin: '0 auto' }}>
                  ເປີດແອັບທະນາຄານຂອງທ່ານ ແລ້ວສະແກນ QR ນີ້ — ໜ້ານີ້ຈະຢືນຢັນເອງເມື່ອຈ່າຍສຳເລັດ
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    marginTop: 18,
                    font: f(500, 12),
                    color: c.faint,
                  }}
                >
                  <Spinner size={13} color={c.faint} />
                  ກຳລັງລໍການຊຳລະ...
                </div>
              </>
            ) : (
              <ErrorNote error={new Error('ຍັງບໍ່ມີ QR ສຳລັບການຈອງນີ້')} />
            )}
          </div>
        </Card>

        <div className="laostay-aside" style={{ display: 'grid', gap: 14 }}>
          <Card>
            <div style={{ font: f(800, 15), color: c.text, marginBottom: 12 }}>ລາຍລະອຽດ</div>
            <Row label="ທີ່ພັກ" value={b.property.name} />
            <Row label="ຫ້ອງ" value={b.roomType?.name ?? '—'} />
            <Row label="ເຂົ້າພັກ" value={laoDateFull(b.checkIn)} />
            <Row label="ອອກ" value={laoDateFull(b.checkOut)} />
            <Row label="ຄືນ / ຄົນ" value={`${b.nights} ຄືນ · ${b.guests} ຄົນ`} />

            <div style={{ borderTop: `1px solid ${c.divider}`, margin: '12px 0' }} />

            <MoneyRow label="ຄ່າຫ້ອງ" amount={kip(b.subtotal)} />
            {b.serviceFee > 0 && <MoneyRow label="ຄ່າບໍລິການ" amount={kip(b.serviceFee)} />}
            {b.tax > 0 && <MoneyRow label="ພາສີ" amount={kip(b.tax)} />}
            {b.discount > 0 && <MoneyRow label="ສ່ວນຫຼຸດ" amount={kip(b.discount)} negative />}
            <MoneyRow label="ລວມທັງໝົດ" amount={kip(b.total)} strong />
          </Card>

          <CancelHoldButton bookingId={b.id} />
        </div>
      </div>
    </div>
  );
}

/** Backing out before paying. Nothing was charged, so the room simply returns. */
function CancelHoldButton({ bookingId }: { bookingId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const cancel = useMutation({
    mutationFn: () =>
      api.post(`/customer/bookings/${bookingId}/cancel`, { reason: 'ຍົກເລີກກ່ອນຊຳລະ' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      navigate('/trips', { replace: true });
    },
  });

  return (
    <>
      <Button variant="danger" full disabled={cancel.isPending} onClick={() => cancel.mutate()}>
        {cancel.isPending ? <Spinner size={15} color={c.dangerFg} /> : 'ຍົກເລີກການຈອງນີ້'}
      </Button>
      {cancel.isError && <ErrorNote error={cancel.error} />}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '4px 0' }}>
      <span style={{ font: f(400, 13), color: c.muted }}>{label}</span>
      <span style={{ font: f(600, 13), color: c.text, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '72px 24px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {children}
    </div>
  );
}
