import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, qs, ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { c, f, type as t } from '../theme';
import { kip, laoDateFull, nightsBetween } from '../lib/format';
import { Button, Card, ErrorNote, Field, Loading, MoneyRow, Page, PageTitle, Photo, Spinner, inputStyle } from '../components/ui';
import type { BookingDetail, PropertyDetail, Quote } from '../lib/types';

/**
 * Review and confirm.
 *
 * The quote is fetched fresh here rather than carried from the property page:
 * the host can change a nightly rate at any moment, and the guest should agree
 * to the price the server will actually charge.
 */
export function CheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const propertyId = params.get('propertyId') ?? '';
  const roomTypeId = params.get('roomTypeId') ?? '';
  const checkIn = params.get('checkIn') ?? '';
  const checkOut = params.get('checkOut') ?? '';
  const guests = Number(params.get('guests') ?? 2);

  const [specialRequest, setSpecialRequest] = useState('');

  // Generated once per mount. A guest who double-taps "confirm", or whose
  // connection drops mid-request and retries, gets the same booking back
  // instead of a second room held in their name.
  const idempotencyKey = useMemo(
    () => `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  const valid = !!roomTypeId && !!checkIn && !!checkOut && nightsBetween(checkIn, checkOut) > 0;

  const property = useQuery({
    queryKey: ['property', propertyId, checkIn, checkOut],
    queryFn: () =>
      api.get<PropertyDetail>(`/properties/${propertyId}` + qs({ checkIn, checkOut })),
    enabled: !!propertyId,
  });

  const quote = useQuery({
    queryKey: ['quote', roomTypeId, checkIn, checkOut, guests],
    queryFn: () =>
      api.post<Quote>('/customer/bookings/quote', { roomTypeId, checkIn, checkOut, guests }),
    enabled: valid,
    retry: false,
  });

  const book = useMutation({
    mutationFn: () =>
      api.post<BookingDetail>('/customer/bookings', {
        roomTypeId,
        checkIn,
        checkOut,
        guests,
        idempotencyKey,
        ...(specialRequest.trim() ? { specialRequest: specialRequest.trim() } : {}),
      }),
    onSuccess: (booking) => navigate(`/pay/${booking.id}`, { replace: true }),
  });

  if (!valid) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
        <ErrorNote error={new Error('ຂໍ້ມູນການຈອງບໍ່ຄົບ ກະລຸນາເລືອກຫ້ອງ ແລະ ວັນທີ່ໃໝ່')} />
        <div style={{ marginTop: 16 }}>
          <Button variant="outline" onClick={() => navigate('/search')}>
            ກັບໄປຄົ້ນຫາ
          </Button>
        </div>
      </div>
    );
  }

  const room = property.data?.roomTypes.find((r) => r.id === roomTypeId);
  const nights = nightsBetween(checkIn, checkOut);

  return (
    <Page width="wide">
      <PageTitle>ຢືນຢັນການຈອງ</PageTitle>

      <div className="phaphak-split">
        <div style={{ display: 'grid', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', gap: 14 }}>
              <Photo
                url={property.data?.images.find((i) => i.isCover)?.url ?? property.data?.images[0]?.url}
                height={84}
                width={110}
              />
              <div style={{ minWidth: 0 }}>
                <div style={{ font: f(800, 16), color: c.text, marginBottom: 3 }}>
                  {property.data?.name ?? '—'}
                </div>
                <div style={{ font: t.caption, color: c.muted, marginBottom: 6 }}>
                  {[property.data?.district, property.data?.province].filter(Boolean).join(', ')}
                </div>
                <div style={{ font: t.label, color: c.accentDark }}>{room?.name ?? '—'}</div>
              </div>
            </div>
          </Card>

          <Card>
            <div style={{ display: 'grid', gap: 12 }}>
              <Row label="ເຂົ້າພັກ" value={laoDateFull(checkIn)} />
              <Row label="ອອກ" value={laoDateFull(checkOut)} />
              <Row label="ຈຳນວນຄືນ" value={`${nights} ຄືນ`} />
              <Row label="ຜູ້ເຂົ້າພັກ" value={`${guests} ຄົນ`} />
              <Row label="ຈອງໃນນາມ" value={user?.fullName ?? user?.email ?? '—'} />
            </div>
          </Card>

          <Card>
            <Field label="ຄຳຂໍພິເສດ (ບໍ່ບັງຄັບ)" hint="ເຊັ່ນ: ຮອດດຶກ, ຂໍຫ້ອງຊັ້ນລຸ່ມ">
              <textarea
                value={specialRequest}
                onChange={(e) => setSpecialRequest(e.target.value)}
                rows={3}
                maxLength={1000}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
          </Card>
        </div>

        <div
          className="phaphak-aside"
          style={{ position: 'sticky', top: 84, display: 'grid', gap: 14 }}
        >
          <Card>
            <div style={{ font: f(800, 16), color: c.text, marginBottom: 12 }}>ສະຫຼຸບລາຄາ</div>

            {quote.isLoading ? (
              <Loading label="ກຳລັງຄິດລາຄາ..." />
            ) : quote.isError ? (
              <ErrorNote error={quote.error} onRetry={() => void quote.refetch()} />
            ) : quote.data ? (
              <>
                <MoneyRow
                  label="ຄ່າຫ້ອງ"
                  note={`${quote.data.nights} ຄືນ`}
                  amount={kip(quote.data.subtotal)}
                />
                {quote.data.serviceFee > 0 && (
                  <MoneyRow label="ຄ່າບໍລິການ" amount={kip(quote.data.serviceFee)} />
                )}
                {quote.data.tax > 0 && <MoneyRow label="ພາສີ" amount={kip(quote.data.tax)} />}
                {quote.data.cleaningFee > 0 && (
                  <MoneyRow label="ຄ່າທຳຄວາມສະອາດ" amount={kip(quote.data.cleaningFee)} />
                )}
                {quote.data.discount > 0 && (
                  <MoneyRow label="ສ່ວນຫຼຸດ" amount={kip(quote.data.discount)} negative />
                )}

                <div style={{ borderTop: `1px solid ${c.divider}`, margin: '10px 0' }} />
                <MoneyRow label="ລວມທັງໝົດ" amount={kip(quote.data.total)} strong />

                <details style={{ marginTop: 12 }}>
                  <summary style={{ font: t.caption, color: c.muted, cursor: 'pointer' }}>
                    ລາຄາແຕ່ລະຄືນ
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    {quote.data.perNight.map((n) => (
                      <MoneyRow key={n.date} label={n.date} amount={kip(n.price)} />
                    ))}
                  </div>
                </details>
              </>
            ) : null}
          </Card>

          {book.isError && (
            <ErrorNote
              error={
                book.error instanceof ApiError && book.error.isConflict
                  ? new Error(
                      `${book.error.message} — ກະລຸນາເລືອກວັນທີ່ ຫຼື ຫ້ອງອື່ນ`,
                    )
                  : book.error
              }
            />
          )}

          <Button
            size="lg"
            full
            data-testid="confirm-booking"
            disabled={!quote.data || book.isPending}
            onClick={() => book.mutate()}
          >
            {book.isPending ? <Spinner size={17} color="#fff" /> : 'ຢືນຢັນ ແລະ ໄປໜ້າຈ່າຍ'}
          </Button>

          <p
            style={{
              font: f(400, 11.5, 18),
              color: c.faint,
              textAlign: 'center',
              margin: 0,
              padding: '0 6px',
            }}
          >
            ຫ້ອງຈະຖືກກັນໄວ້ໃຫ້ 15 ນາທີ ເພື່ອໃຫ້ທ່ານຈ່າຍ — ຍັງບໍ່ຕັດເງິນໃນຂັ້ນຕອນນີ້
          </p>
        </div>
      </div>
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ font: t.bodySm, color: c.muted }}>{label}</span>
      <span style={{ font: t.label, color: c.text, textAlign: 'right' }}>{value}</span>
    </div>
  );
}
