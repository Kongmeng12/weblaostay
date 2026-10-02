import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, tokens } from '../lib/api';
import { c, f, radius, type as t } from '../theme';
import { countdown, kip, laoDateFull } from '../lib/format';
import { Button, Card, ErrorNote, Loading, MoneyRow, Page, Spinner } from '../components/ui';
import { QrCode } from '../components/QrCode';
import type { BookingDetail, Payment, PaymentChannels } from '../lib/types';

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

  // The guest picks their bank (or card) first; null while choosing.
  const [channel, setChannel] = useState<string | null>(null);

  const channels = useQuery({
    queryKey: ['payment-channels'],
    queryFn: () => api.get<PaymentChannels>('/customer/payment-channels'),
    enabled: booking.data?.status === 'pending',
  });

  // Issuing a charge is idempotent server-side per channel: a live one is
  // returned rather than replaced, so a refresh does not strand the code
  // already open in a banking app. Picking another channel retires it.
  const payment = useQuery({
    queryKey: ['payment', bookingId, channel],
    queryFn: () => api.post<Payment>(`/customer/bookings/${bookingId}/pay`, { channel }),
    enabled: booking.data?.status === 'pending' && !!channel,
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

  // Guards read synchronously by the abandonment handlers below — refs, not
  // state, since an unmount/pagehide callback can't wait for a re-render.
  const paidRef = useRef(false);
  const statusRef = useRef(booking.data?.status);
  statusRef.current = booking.data?.status;
  if (settled) paidRef.current = true;

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

  // Release the hold the moment the guest leaves this screen without paying —
  // back button, in-app nav away, or the browser tab closing — instead of
  // waiting on the server's passive hold-expiry sweeper. Best-effort and
  // silent: this is an optimization to free the room sooner, not something
  // the guest needs to see succeed or fail.
  useEffect(() => {
    return () => {
      if (paidRef.current || statusRef.current !== 'pending') return;
      void api
        .post(`/customer/bookings/${bookingId}/cancel`, { reason: 'abandoned pay page' })
        .catch(() => {});
    };
  }, [bookingId]);

  useEffect(() => {
    const cancelBeacon = () => {
      if (paidRef.current || statusRef.current !== 'pending') return;
      const access = tokens.access();
      fetch(`/api/customer/bookings/${bookingId}/cancel`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
        },
        body: JSON.stringify({ reason: 'abandoned pay page' }),
      }).catch(() => {});
    };
    window.addEventListener('pagehide', cancelBeacon);
    return () => window.removeEventListener('pagehide', cancelBeacon);
  }, [bookingId]);

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
        <h1 style={{ font: t.h1, color: c.text, margin: '0 0 8px' }}>ຊຳລະສຳເລັດ</h1>
        <p style={{ font: t.body, color: c.muted, margin: '0 0 22px' }}>
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
        <h1 style={{ font: t.h2, color: c.text, margin: '0 0 8px' }}>
          ໝົດເວລາກັນຫ້ອງແລ້ວ
        </h1>
        <p style={{ font: t.body, color: c.muted, margin: '0 0 22px', maxWidth: 380 }}>
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
        <h1 style={{ font: t.h2, color: c.text, margin: '0 0 8px' }}>
          ການຈອງນີ້ບໍ່ຕ້ອງຊຳລະແລ້ວ
        </h1>
        <Button size="lg" onClick={() => navigate(`/trips/${b.id}`)}>
          ເບິ່ງລາຍລະອຽດ
        </Button>
      </Centre>
    );
  }

  return (
    <Page width="wide">
      <h1 style={{ font: t.h1, color: c.text, margin: '0 0 6px' }}>ຊຳລະເງິນ</h1>
      <p style={{ font: t.bodySm, color: c.muted, margin: '0 0 22px' }}>
        ການຈອງ <b style={{ color: c.text }}>{b.code}</b> · {b.property.name}
      </p>

      <div className="phaphak-split">
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
                  font: t.label,
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
                  font: t.label,
                  marginBottom: 18,
                }}
              >
                ໝົດເວລາກັນຫ້ອງ — ກຳລັງກວດສະຖານະ
              </div>
            )}

            {!channel ? (
              <ChannelPicker
                data={channels.data}
                loading={channels.isLoading}
                error={channels.isError ? channels.error : null}
                onRetry={() => void channels.refetch()}
                total={b.total}
                onPick={setChannel}
              />
            ) : payment.isLoading ? (
              <Loading label="ກຳລັງສ້າງ QR..." />
            ) : payment.isError ? (
              <>
                <ErrorNote error={payment.error} onRetry={() => void payment.refetch()} />
                <ChangeChannel onClick={() => setChannel(null)} />
              </>
            ) : channel === 'card' && payment.data?.deepLink ? (
              <>
                <div style={{ fontSize: 44, marginBottom: 8 }}>💳</div>
                <div style={{ font: t.h2, color: c.accent, margin: '0 0 6px' }}>
                  {kip(payment.data.amount)}
                </div>
                <div style={{ font: t.bodySm, color: c.muted, maxWidth: 340, margin: '0 auto 16px' }}>
                  ໃສ່ຂໍ້ມູນບັດໃນໜ້າທີ່ເປີດຂຶ້ນ — ໜ້ານີ້ຈະຢືນຢັນເອງເມື່ອຈ່າຍສຳເລັດ
                </div>
                <a
                  href={payment.data.deepLink}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-block',
                    padding: '12px 22px',
                    borderRadius: radius.md,
                    background: c.accent,
                    color: '#fff',
                    font: t.label,
                    textDecoration: 'none',
                  }}
                >
                  ໄປໜ້າຈ່າຍດ້ວຍບັດ
                </a>
                <ChangeChannel onClick={() => setChannel(null)} />
                <Waiting />
              </>
            ) : payment.data?.qrPayload ? (
              <>
                <div style={{ font: t.h3, color: c.text, marginBottom: 12 }}>
                  ສະແກນດ້ວຍແອັບ {CHANNEL_LOOK[channel]?.name ?? channel}
                </div>
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

                <div style={{ font: t.h2, color: c.accent, margin: '18px 0 4px' }}>
                  {kip(payment.data.amount)}
                </div>
                <div style={{ font: t.bodySm, color: c.muted, maxWidth: 320, margin: '0 auto' }}>
                  ເປີດແອັບທະນາຄານຂອງທ່ານ ແລ້ວສະແກນ QR ນີ້ — ໜ້ານີ້ຈະຢືນຢັນເອງເມື່ອຈ່າຍສຳເລັດ
                </div>

                {/* On the phone the guest is holding, the screen showing this QR
                    is the one they would have to scan. The bank's own link is
                    the way out of that. */}
                {payment.data.deepLink && (
                  <a
                    href={payment.data.deepLink}
                    style={{
                      display: 'inline-block',
                      marginTop: 14,
                      padding: '11px 20px',
                      borderRadius: radius.md,
                      border: `1px solid ${c.border}`,
                      background: '#fff',
                      font: t.label,
                      color: c.text,
                    }}
                  >
                    ເປີດແອັບ {CHANNEL_LOOK[channel]?.name ?? 'ທະນາຄານ'}
                  </a>
                )}

                <ChangeChannel onClick={() => setChannel(null)} />
                <Waiting />
              </>
            ) : (
              <ErrorNote error={new Error('ຍັງບໍ່ມີ QR ສຳລັບການຈອງນີ້')} />
            )}
          </div>
        </Card>

        <div className="phaphak-aside" style={{ display: 'grid', gap: 14 }}>
          <Card>
            <div style={{ font: t.h3, color: c.text, marginBottom: 12 }}>ລາຍລະອຽດ</div>
            <Row label="ທີ່ພັກ" value={b.property.name} />
            <Row label="ຫ້ອງ" value={b.roomType?.name ?? '—'} />
            {/* Empty for the ordinary flow, where the partner assigns a room
                after booking — only a guest who picked a specific room at
                booking time sees a number here. */}
            {b.roomType && b.roomType.roomNumbers.length > 0 && (
              <Row label="ເລກຫ້ອງ" value={b.roomType.roomNumbers.join(', ')} />
            )}
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
    </Page>
  );
}

/** How each channel is shown — the names on the guest's own banking app. */
const CHANNEL_LOOK: Record<string, { name: string; mark: string; color: string }> = {
  bcel: { name: 'BCEL One', mark: 'B', color: '#D71920' },
  jdb: { name: 'JDB', mark: 'J', color: '#1B3F8B' },
  ldb: { name: 'LDB', mark: 'L', color: '#1E88C8' },
  ib: { name: 'Indochina Bank', mark: 'IB', color: '#5B2C83' },
  stb: { name: 'STB', mark: 'S', color: '#1A3D9C' },
  m_money: { name: 'M-Money', mark: 'm', color: '#E2231A' },
  card: { name: 'Visa / Mastercard', mark: '💳', color: '#2B2521' },
};

/** Step one: the banks, then cards, each group one card with hairlines between rows. */
function ChannelPicker({
  data,
  loading,
  error,
  onRetry,
  total,
  onPick,
}: {
  data: PaymentChannels | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  total: number;
  onPick: (id: string) => void;
}) {
  if (loading) return <Loading label="ກຳລັງໂຫຼດ..." />;
  if (error || !data) return <ErrorNote error={error ?? new Error('ໂຫຼດບໍ່ໄດ້')} onRetry={onRetry} />;

  const groups: { title: string; subtitle: string; ids: PaymentChannels['channels'] }[] = [
    {
      title: 'ຊຳລະຜ່ານທະນາຄານ',
      subtitle: 'ຈ່າຍຜ່ານບັນຊີທະນາຄານ',
      ids: data.channels.filter((ch) => ch.group === 'bank'),
    },
    {
      title: 'ບັດ Credit / Debit',
      subtitle: 'Visa · Mastercard (ບັດທີ່ຮອງຮັບ 3DS)',
      ids: data.channels.filter((ch) => ch.group === 'card'),
    },
  ];

  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ font: t.h3, color: c.text, marginBottom: 4 }}>ເລືອກວິທີຈ່າຍ</div>
      {groups
        .filter((g) => g.ids.length)
        .map((g) => (
          <div key={g.title}>
            <div style={{ font: f(700, 12), color: c.muted, margin: '16px 2px 8px' }}>{g.title}</div>
            <div style={{ border: `1px solid ${c.border}`, borderRadius: radius.lg, overflow: 'hidden' }}>
              {g.ids.map((ch, i) => {
                const look = CHANNEL_LOOK[ch.id] ?? { name: ch.id, mark: ch.id[0], color: c.muted };
                const tooSmall = ch.minAmount !== null && total < ch.minAmount;
                return (
                  <button
                    key={ch.id}
                    disabled={tooSmall}
                    onClick={() => onPick(ch.id)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '13px 16px',
                      background: '#fff',
                      border: 'none',
                      borderTop: i ? `1px solid ${c.divider}` : 'none',
                      cursor: tooSmall ? 'not-allowed' : 'pointer',
                      opacity: tooSmall ? 0.45 : 1,
                      textAlign: 'left',
                    }}
                  >
                    <span
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: look.color,
                        color: '#fff',
                        display: 'grid',
                        placeItems: 'center',
                        font: f(800, 13),
                        flex: 'none',
                      }}
                    >
                      {look.mark}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', font: t.label, color: c.text }}>{look.name}</span>
                      <span style={{ display: 'block', font: f(400, 12), color: c.muted }}>
                        {tooSmall ? `ຂັ້ນຕ່ຳ ${kip(ch.minAmount)}` : g.subtitle}
                      </span>
                    </span>
                    <span style={{ color: c.faint, fontSize: 18 }}>›</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
    </div>
  );
}

function ChangeChannel({ onClick }: { onClick: () => void }) {
  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={onClick}
        style={{ background: 'none', border: 'none', color: c.accent, font: t.label, cursor: 'pointer' }}
      >
        ປ່ຽນວິທີຈ່າຍ
      </button>
    </div>
  );
}

function Waiting() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginTop: 14,
        font: f(500, 12),
        color: c.faint,
      }}
    >
      <Spinner size={13} color={c.faint} />
      ກຳລັງລໍການຊຳລະ...
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
      <span style={{ font: t.bodySm, color: c.muted }}>{label}</span>
      <span style={{ font: t.label, color: c.text, textAlign: 'right' }}>{value}</span>
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
