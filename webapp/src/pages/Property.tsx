import { lazy, Suspense, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import {
  c,
  f,
  radius,
  shadow,
  space,
  type as t,
  TAP,
  MAX_WIDTH,
  PROPERTY_TYPE_LABEL,
  BED_TYPE_LABEL,
} from '../theme';
import { addDaysIso, kip, laoDate, mapsUrl, nightsBetween, stars } from '../lib/format';
import { DateRangePicker } from '../components/DateRangePicker';
import {
  Button,
  Card,
  ErrorNote,
  Loading,
  Photo,
  Pill,
  Section,
  Skeleton,
  StickyBar,
  Stars,
} from '../components/ui';

/**
 * Leaflet and its stylesheet are around 45 kB gzipped and only two screens
 * want them, so they are fetched when a map is actually rendered rather than
 * bundled into the entry chunk that every page pays for.
 */
const PropertyMap = lazy(() => import('../components/PropertyMap'));
import type { PropertyDetail, RoomOffer, RoomUnitsResponse, WishlistItem } from '../lib/types';
import { useStartConversation } from './Messages';
import { ReviewReplies } from '../components/ReviewReplies';
import { ReportReview } from '../components/ReportReview';

export function PropertyPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const checkIn = params.get('checkIn') ?? '';
  const checkOut = params.get('checkOut') ?? '';
  const guests = Number(params.get('guests') ?? 2);
  const hasRange = !!checkIn && !!checkOut;
  const nights = hasRange ? nightsBetween(checkIn, checkOut) : 0;

  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  // The specific physical room picked inside the selected room type, if any —
  // only meaningful when that room type has `allowRoomSelection`. Kept
  // separate from `selectedRoom` because picking one is always optional: the
  // ordinary "partner assigns later" flow is just this staying null.
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['property', id, checkIn, checkOut],
    queryFn: () =>
      api.get<PropertyDetail>(
        `/properties/${id}` + qs(hasRange ? { checkIn, checkOut } : {}),
      ),
  });

  const wishlist = useQuery({
    queryKey: ['wishlist'],
    queryFn: () => api.get<WishlistItem[]>('/customer/wishlist'),
    enabled: !!user,
  });
  const saved = wishlist.data?.some((w) => w.propertyId === id) ?? false;

  const startChat = useStartConversation();

  const toggleSaved = useMutation({
    mutationFn: () =>
      saved
        ? api.post(`/customer/wishlist/${id}/remove`)
        : api.post(`/customer/wishlist/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wishlist'] }),
  });

  function setDates(next: { checkIn?: string; checkOut?: string; guests?: number }) {
    const merged = { checkIn, checkOut, guests, ...next };
    // Only guess a departure when the caller did not name one. `DateRangePicker`
    // sends both ends together and deliberately sends an empty check-out
    // between the two taps — filling that in would collapse the range it is
    // still drawing.
    if (next.checkOut === undefined && next.checkIn && (!merged.checkOut || merged.checkOut <= next.checkIn)) {
      merged.checkOut = addDaysIso(next.checkIn, 1);
    }
    // A specific room picked for the old dates may not be free for the new
    // ones — the picker below refetches from scratch, so drop the pick rather
    // than silently carrying forward a room that might no longer be available.
    if (merged.checkIn !== checkIn || merged.checkOut !== checkOut) {
      setSelectedUnit(null);
    }
    setParams(
      new URLSearchParams(
        Object.entries({
          checkIn: merged.checkIn,
          checkOut: merged.checkOut,
          guests: String(merged.guests),
        }).filter(([, v]) => !!v) as [string, string][],
      ),
      { replace: true },
    );
  }

  if (query.isLoading) return <Loading />;
  if (query.isError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const p = query.data!;
  const room = p.roomTypes.find((r) => r.id === selectedRoom) ?? null;
  const bookable = room && hasRange && room.available === true;

  function book() {
    if (!room) return;
    const target =
      '/checkout' +
      qs({
        propertyId: p.id,
        roomTypeId: room.id,
        checkIn,
        checkOut,
        guests,
        // Only ever carried for a room type that opted in — `selectedUnit` is
        // reset whenever the room type or dates change, but this guard keeps
        // a stale id from leaking through even if that ever regresses.
        ...(room.allowRoomSelection && selectedUnit ? { roomId: selectedUnit } : {}),
      });
    navigate(user ? target : '/signin', user ? undefined : { state: { from: target } });
  }

  return (
    <div style={{ paddingBottom: 20 }}>
      {galleryIndex !== null && (
        <GalleryLightbox
          images={p.images.map((img) => img.url)}
          name={p.name}
          index={galleryIndex}
          onChange={setGalleryIndex}
          onClose={() => setGalleryIndex(null)}
        />
      )}

      {/* gallery strip — click any photo to open the lightbox */}
      <div
        className="phaphak-strip"
        style={{ display: 'flex', gap: 4, background: c.neutralBg, position: 'relative' }}
      >
        {(p.images.length ? p.images : [{ url: '', caption: null, isCover: true }]).map(
          (img, i) => (
            <div
              key={i}
              onClick={() => p.images.length > 0 && setGalleryIndex(i)}
              style={{
                flex: 'none',
                scrollSnapAlign: 'start',
                cursor: p.images.length > 0 ? 'pointer' : 'default',
              }}
            >
              <Photo
                url={img.url || null}
                alt={p.name}
                height={300}
                width={p.images.length > 1 ? 'min(78vw, 560px)' : '100%'}
                rounded={0}
              />
            </div>
          ),
        )}

        {p.images.length > 1 && (
          <button
            onClick={() => setGalleryIndex(0)}
            style={{
              position: 'absolute',
              bottom: 12,
              right: 12,
              padding: '6px 14px',
              background: 'rgba(0,0,0,0.55)',
              color: '#fff',
              border: 'none',
              borderRadius: radius.pill,
              font: f(600, 12),
              cursor: 'pointer',
              backdropFilter: 'blur(4px)',
            }}
          >
            ເບິ່ງທັງໝົດ {p.images.length} ຮູບ
          </button>
        )}
      </div>

      <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto', padding: `${space[4]}px 18px 0` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: space[4], flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <Pill bg={c.infoBg} fg={c.infoFg}>
                {PROPERTY_TYPE_LABEL[p.type] ?? p.type}
              </Pill>
              <Stars value={p.rating} count={p.reviewCount} />
            </div>
            <h1 style={{ font: t.h1, color: c.text, margin: '0 0 6px' }}>{p.name}</h1>
            <div style={{ font: t.bodySm, color: c.muted }}>
              {[p.village, p.district, p.province].filter(Boolean).join(', ')}
              {p.address ? ` · ${p.address}` : ''}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            {user && (
              <Button
                variant="outline"
                onClick={() => toggleSaved.mutate()}
                disabled={toggleSaved.isPending}
              >
                {saved ? '♥ ບັນທຶກແລ້ວ' : '♡ ບັນທຶກ'}
              </Button>
            )}
            {/* No booking needed — asking before booking is the point. The
                button waits for the session check: pressing it a moment after a
                page load must not send a signed-in guest to the sign-in page. */}
            <Button
              variant="outline"
              data-testid="ask-host"
              disabled={startChat.isPending || authLoading}
              onClick={() => {
                if (!user) {
                  navigate('/signin', { state: { from: `/property/${p.id}` } });
                  return;
                }
                startChat.mutate({ propertyId: p.id });
              }}
            >
              💬 ຖາມທີ່ພັກ
            </Button>
          </div>
        </div>

        {p.description && (
          <p style={{ font: t.body, color: c.soft, margin: `${space[4]}px 0 0` }}>
            {p.description}
          </p>
        )}
      </div>

      {/*
        Two columns on a desktop, one on a phone.

        The booking panel used to be a card in the flow plus a bar pinned to the
        bottom of the window — a phone layout that a wide screen inherited, so
        the calendar pushed the rooms nearly 300px below the fold and the thing
        you came to buy was off-screen. `phaphak-aside-first` puts the panel
        back above the rooms when the columns collapse, because a guest picks
        dates before a room.
      */}
      <div
        className="phaphak-split phaphak-aside-first"
        style={{ maxWidth: MAX_WIDTH, margin: '0 auto', padding: `${space[5]}px 18px 0` }}
      >
        <div style={{ minWidth: 0 }}>
        <Section title={hasRange ? `ຫ້ອງວ່າງ · ${nights} ຄືນ` : 'ຫ້ອງພັກ'}>
          <div style={{ display: 'grid', gap: 12 }}>
            {p.roomTypes.map((rt) => (
              <RoomRow
                key={rt.id}
                room={rt}
                nights={nights}
                hasRange={hasRange}
                checkIn={checkIn}
                checkOut={checkOut}
                selected={selectedRoom === rt.id}
                onSelect={() => {
                  // Re-clicking the row you already picked must not wipe a
                  // room number you already chose inside it — only switching
                  // to a *different* room type should reset that pick.
                  if (selectedRoom !== rt.id) setSelectedUnit(null);
                  setSelectedRoom(rt.id);
                }}
                selectedUnit={selectedUnit}
                onSelectUnit={setSelectedUnit}
              />
            ))}
          </div>
        </Section>

        {p.amenities.length > 0 && (
          <Section title="ສິ່ງອຳນວຍຄວາມສະດວກ">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {p.amenities.map((a) => (
                <span
                  key={a.id}
                  style={{
                    padding: '8px 14px',
                    background: c.bg,
                    border: `1px solid ${c.border}`,
                    borderRadius: 999,
                    font: t.caption,
                    color: c.soft,
                  }}
                >
                  {a.name}
                </span>
              ))}
            </div>
          </Section>
        )}

        {p.rules && (
          <Section title="ກົດລະບຽບທີ່ພັກ">
            <Card>
              <div style={{ display: 'grid', gap: 8 }}>
                <Rule label="ເຊັກອິນ" value={p.rules.checkInFrom ? `ຈາກ ${p.rules.checkInFrom}` : '—'} />
                <Rule
                  label="ເຊັກເອົາ"
                  value={p.rules.checkOutUntil ? `ກ່ອນ ${p.rules.checkOutUntil}` : '—'}
                />
                <Rule label="ສູບຢາ" value={p.rules.smokingAllowed ? 'ອະນຸຍາດ' : 'ບໍ່ອະນຸຍາດ'} />
                <Rule label="ສັດລ້ຽງ" value={p.rules.petAllowed ? 'ອະນຸຍາດ' : 'ບໍ່ອະນຸຍາດ'} />
                <Rule label="ເດັກນ້ອຍ" value={p.rules.childAllowed ? 'ອະນຸຍາດ' : 'ບໍ່ອະນຸຍາດ'} />
                <Rule label="ຈັດງານລ້ຽງ" value={p.rules.partyAllowed ? 'ອະນຸຍາດ' : 'ບໍ່ອະນຸຍາດ'} />
                {p.rules.quietHoursStart && (
                  <Rule
                    label="ເວລາງຽບ"
                    value={`${p.rules.quietHoursStart} – ${p.rules.quietHoursEnd ?? ''}`}
                  />
                )}
                {p.rules.note && (
                  <p style={{ font: t.bodySm, color: c.muted, margin: '6px 0 0' }}>
                    {p.rules.note}
                  </p>
                )}
              </div>
            </Card>
          </Section>
        )}

        {p.cancellationPolicy && (
          <Section title="ນະໂຍບາຍການຍົກເລີກ">
            <Card>
              <div style={{ font: t.h3, color: c.text, marginBottom: 6 }}>
                {p.cancellationPolicy.name}
              </div>
              <div style={{ font: t.bodySm, color: c.soft }}>
                {p.cancellationPolicy.isRefundable
                  ? `ຍົກເລີກກ່ອນເຂົ້າພັກ ${p.cancellationPolicy.daysBeforeCheckin} ວັນ ຫັກ ${p.cancellationPolicy.penaltyPercent}% ຂອງຍອດທີ່ຈ່າຍມາ ສ່ວນທີ່ເຫຼືອຄືນໃຫ້`
                  : 'ຫ້ອງນີ້ຍົກເລີກແລ້ວບໍ່ຄືນເງິນ'}
              </div>
              {p.cancellationPolicy.description && (
                <div style={{ font: t.caption, color: c.muted, marginTop: 8 }}>
                  {p.cancellationPolicy.description}
                </div>
              )}
            </Card>
          </Section>
        )}

        <LocationSection property={p} />

        {p.reviews.length > 0 && (
          <Section title={`ຮີວິວ (${p.reviewCount})`}>
            <div style={{ display: 'grid', gap: 12 }}>
              {p.reviews.map((r) => (
                <Card key={r.id}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ font: t.bodySm, color: c.text }}>{r.guest}</span>
                    <span style={{ font: t.label, color: c.star }}>{stars(r.stars)}</span>
                    <span style={{ font: t.caption, color: c.faint }}>
                      · {laoDate(r.createdAt)}
                    </span>
                  </div>
                  {r.title && (
                    <div style={{ font: t.bodySm, color: c.text, marginBottom: 4 }}>
                      {r.title}
                    </div>
                  )}
                  {r.comment && (
                    <div style={{ font: t.bodySm, color: c.soft }}>{r.comment}</div>
                  )}
                  {/* The host's answer matters as much as the complaint — a
                      guest reading only half the exchange is being misled. */}
                  <ReviewReplies reviewId={r.id} />
                  <ReportReview reviewId={r.id} />
                </Card>
              ))}
            </div>
          </Section>
        )}

        <div style={{ font: t.caption, color: c.muted, marginBottom: space[5] }}>
          ເຈົ້າຂອງທີ່ພັກ: {p.host.name}
          {p.phone && ` · ${p.phone}`}
        </div>
        </div>

        <aside className="phaphak-aside">
          <div
            style={{
              padding: space[4],
              background: c.surface,
              border: `1px solid ${c.border}`,
              borderRadius: radius.lg,
              boxShadow: shadow.card,
              display: 'grid',
              gap: space[3],
            }}
          >
            <DateRangePicker
              checkIn={checkIn}
              checkOut={checkOut}
              onChange={(range) => setDates(range)}
            />

            <label>
              <span style={{ font: t.label, color: c.muted, display: 'block', marginBottom: space[1] }}>
                ຜູ້ເຂົ້າພັກ
              </span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={guests}
                onChange={(e) =>
                  setDates({ guests: Math.max(1, Math.floor(Number(e.target.value)) || 1) })
                }
                style={dateInput}
              />
            </label>

            {!hasRange && (
              <p style={{ font: t.caption, color: c.warnFg, margin: 0 }}>
                ເລືອກວັນທີ່ກ່ອນ ຈຶ່ງຈະເຫັນລາຄາລວມ ແລະ ຈອງໄດ້
              </p>
            )}

            <div
              className="phaphak-desktop-only"
              style={{ borderTop: `1px solid ${c.divider}`, paddingTop: space[3] }}
            >
              {room ? (
                <>
                  <div style={{ font: t.label, color: c.muted, marginBottom: space[1] }}>
                    {room.name}
                  </div>
                  <div style={{ font: t.h3, color: c.text }}>
                    {room.stayTotal !== null
                      ? `${kip(room.stayTotal)} · ${nights} ຄືນ`
                      : `${kip(room.basePrice)} / ຄືນ`}
                  </div>
                </>
              ) : (
                <div style={{ font: t.bodySm, color: c.muted }}>ເລືອກຫ້ອງເພື່ອຈອງ</div>
              )}
            </div>

            <div className="phaphak-desktop-only">
              <Button size="lg" full data-testid="book" disabled={!bookable} onClick={book}>
                {!hasRange ? 'ເລືອກວັນທີ່ກ່ອນ' : !room ? 'ເລືອກຫ້ອງ' : bookable ? 'ຈອງເລີຍ' : 'ຫ້ອງເຕັມ'}
              </Button>
            </div>
          </div>
        </aside>
      </div>

      {/*
        Phones only — above 860px the panel on the right does this job and the
        bar would sit on top of it. Kept because on a phone the rooms are a long
        scroll and the price has to stay in reach.
      */}
      <StickyBar className="phaphak-mobile-only">
        <div style={{ flex: 1, minWidth: 0 }}>
          {room ? (
            <>
              <div
                style={{
                  font: t.bodySm,
                  color: c.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {room.name}
              </div>
              <div style={{ font: t.caption, color: c.muted }}>
                {room.stayTotal !== null
                  ? `${kip(room.stayTotal)} · ${nights} ຄືນ`
                  : `${kip(room.basePrice)} / ຄືນ`}
              </div>
            </>
          ) : (
            <div style={{ font: t.label, color: c.muted }}>ເລືອກຫ້ອງເພື່ອຈອງ</div>
          )}
        </div>

        <Button size="lg" data-testid="book-mobile" disabled={!bookable} onClick={book}>
          {!hasRange ? 'ເລືອກວັນທີ່ກ່ອນ' : !room ? 'ເລືອກຫ້ອງ' : bookable ? 'ຈອງເລີຍ' : 'ຫ້ອງເຕັມ'}
        </Button>
      </StickyBar>
    </div>
  );
}

/**
 * Where the place actually is.
 *
 * The section renders whether or not the property has coordinates, because
 * only the seeded demo properties have any: every property created through
 * partner sign-up is born with `latitude`/`longitude` NULL, and there is no
 * screen anywhere that fills them in yet. Without coordinates a guest still
 * gets the written address and a Google search for it, which is the answer
 * they came for; hiding the whole section would leave them with nothing.
 */
function LocationSection({ property }: { property: PropertyDetail }) {
  const address =
    [property.village, property.district, property.province].filter(Boolean).join(', ') +
    (property.address ? ` · ${property.address}` : '');

  const hasPin = typeof property.lat === 'number' && typeof property.lng === 'number';
  const href = mapsUrl(
    { lat: property.lat, lng: property.lng, name: property.name, address: property.address },
    property.district,
    property.province,
  );

  if (!address.trim() && !hasPin) return null;

  return (
    <Section title="ທີ່ຕັ້ງ">
      <div style={{ display: 'grid', gap: 12 }} data-testid="location">
        {address.trim() && (
          <div style={{ font: f(400, 13.5, 21), color: c.soft }}>{address}</div>
        )}

        {hasPin && (
          <Suspense fallback={<Skeleton height={260} style={{ borderRadius: radius.lg }} />}>
            <PropertyMap lat={property.lat!} lng={property.lng!} name={property.name} />
          </Suspense>
        )}

        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: TAP,
              font: t.label,
              color: c.accent,
              textDecoration: 'none',
            }}
          >
            {hasPin ? 'ເປີດໃນ Google Maps ເພື່ອນຳທາງ →' : 'ຄົ້ນຫາທີ່ຢູ່ນີ້ໃນ Google Maps →'}
          </a>
        )}
      </div>
    </Section>
  );
}

function RoomRow({
  room,
  nights,
  hasRange,
  checkIn,
  checkOut,
  selected,
  onSelect,
  selectedUnit,
  onSelectUnit,
}: {
  room: RoomOffer;
  nights: number;
  hasRange: boolean;
  checkIn: string;
  checkOut: string;
  selected: boolean;
  onSelect: () => void;
  selectedUnit: string | null;
  onSelectUnit: (unitId: string | null) => void;
}) {
  const soldOut = hasRange && room.available === false;
  const tooShort = hasRange && nights > 0 && nights < room.minNights;
  const blocked = soldOut || tooShort;

  // The room-number picker only makes sense once this offer is the one being
  // booked, is actually bookable, and dates are known (the endpoint 400s
  // without a range).
  const showUnitPicker = selected && !blocked && room.allowRoomSelection && hasRange;

  return (
    <div
      // Stable hooks for the end-to-end journey test. Matching on Lao copy
      // instead would make every wording change a broken test.
      data-room-id={room.id}
      data-room-bookable={blocked ? 'false' : 'true'}
      style={{
        background: c.surface,
        border: `1.5px solid ${selected ? c.accent : c.border}`,
        borderRadius: radius.lg,
        boxShadow: selected ? shadow.card : 'none',
        overflow: 'hidden',
      }}
    >
      <div
        onClick={blocked ? undefined : onSelect}
        style={{
          display: 'flex',
          gap: 14,
          padding: 14,
          opacity: blocked ? 0.6 : 1,
          cursor: blocked ? 'not-allowed' : 'pointer',
        }}
      >
        <Photo url={room.images[0] ?? null} alt={room.name} height={86} width={110} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: t.h3, color: c.text, marginBottom: 3 }}>{room.name}</div>
          <div style={{ font: t.caption, color: c.muted, marginBottom: 6 }}>
            {BED_TYPE_LABEL[room.bedType] ?? room.bedType}
            {room.hasAc ? ' · ມີແອ' : ''}
            {room.sizeSqm ? ` · ${room.sizeSqm} ຕ.ມ.` : ''}
          </div>

          {/* Say exactly why a room cannot be booked. "Unavailable" makes the
              guest change the wrong thing. */}
          {tooShort ? (
            <Pill bg={c.warnBg} fg={c.warnFg}>ຕ້ອງພັກຢ່າງໜ້ອຍ {room.minNights} ຄືນ</Pill>
          ) : soldOut ? (
            <Pill bg={c.neutralBg} fg={c.neutralFg}>ເຕັມໃນວັນທີ່ເລືອກ</Pill>
          ) : selected ? (
            <Pill bg={c.accentSoft} fg={c.accentDark}>ເລືອກແລ້ວ</Pill>
          ) : room.allowRoomSelection ? (
            <Pill bg={c.infoBg} fg={c.infoFg}>ເລືອກເລກຫ້ອງໄດ້</Pill>
          ) : null}
        </div>

        <div style={{ textAlign: 'right', flex: 'none' }}>
          {room.stayTotal !== null ? (
            <>
              <div style={{ font: f(800, 16), color: c.accent }}>{kip(room.stayTotal)}</div>
              <div style={{ font: t.caption, color: c.muted }}>{nights} ຄືນ</div>
            </>
          ) : (
            <>
              <div style={{ font: f(800, 16), color: c.accent }}>{kip(room.basePrice)}</div>
              <div style={{ font: t.caption, color: c.muted }}>/ ຄືນ</div>
            </>
          )}
        </div>
      </div>

      {showUnitPicker && (
        <div
          // Selecting a specific room must not also toggle the row's
          // selection above (it already is selected — this just stops the
          // click bubbling into a no-op re-select for no reason).
          onClick={(e) => e.stopPropagation()}
          style={{ borderTop: `1px solid ${c.divider}`, background: c.bg, padding: 14 }}
        >
          <RoomUnitPicker
            roomTypeId={room.id}
            checkIn={checkIn}
            checkOut={checkOut}
            selectedUnit={selectedUnit}
            onSelect={onSelectUnit}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Lets a guest pick which physical room they get, for room types where the
 * partner has opted in. Always optional — leaving it on "ບໍ່ລະບຸ" is exactly
 * today's ordinary flow, where the partner assigns a room after booking.
 *
 * Fetched fresh per room type and date range: the list is only the rooms
 * actually free for those dates, so it must refetch whenever either changes.
 */
function RoomUnitPicker({
  roomTypeId,
  checkIn,
  checkOut,
  selectedUnit,
  onSelect,
}: {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  selectedUnit: string | null;
  onSelect: (unitId: string | null) => void;
}) {
  const query = useQuery({
    queryKey: ['room-units', roomTypeId, checkIn, checkOut],
    queryFn: () =>
      api.get<RoomUnitsResponse>(`/room-types/${roomTypeId}/rooms` + qs({ checkIn, checkOut })),
    enabled: !!roomTypeId && !!checkIn && !!checkOut,
  });

  return (
    <div>
      <div style={{ font: t.label, color: c.text, marginBottom: 8 }}>
        ເລືອກເລກຫ້ອງ (ບໍ່ບັງຄັບ)
      </div>

      {query.isLoading ? (
        <div style={{ font: t.caption, color: c.muted }}>ກຳລັງໂຫຼດເລກຫ້ອງ...</div>
      ) : query.isError ? (
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            data-room-unit-bookable="true"
            onClick={() => onSelect(null)}
            style={unitChipStyle(selectedUnit === null)}
          >
            ບໍ່ລະບຸ · ໃຫ້ທີ່ພັກຈັດໃຫ້
          </button>

          {query.data?.rooms.map((unit) => (
            <button
              key={unit.id}
              type="button"
              data-room-unit-id={unit.id}
              data-room-unit-bookable="true"
              onClick={() => onSelect(unit.id)}
              style={unitChipStyle(selectedUnit === unit.id)}
            >
              ຫ້ອງ {unit.roomNumber}
              {unit.floor ? ` · ຊັ້ນ ${unit.floor}` : ''}
            </button>
          ))}

          {/* The server already filters to rooms free for these dates, so an
              empty list here means none of this type's specific rooms are
              free — the same "sold out" treatment used above, not an error. */}
          {query.data && query.data.rooms.length === 0 && (
            <Pill bg={c.neutralBg} fg={c.neutralFg}>ບໍ່ມີເລກຫ້ອງວ່າງໃຫ້ເລືອກ · ຈະຈັດໃຫ້ອັດຕະໂນມັດ</Pill>
          )}
        </div>
      )}
    </div>
  );
}

function unitChipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: radius.pill,
    border: `1.5px solid ${active ? c.accent : c.border}`,
    background: active ? c.accentSoft : c.surface,
    color: active ? c.accentDark : c.text,
    font: t.label,
    cursor: 'pointer',
  };
}

const dateInput: React.CSSProperties = {
  width: '100%',
  height: 44,
  padding: '0 12px',
  background: '#fff',
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  font: t.bodySm,
  color: c.text,
  outline: 'none',
};

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ font: t.bodySm, color: c.muted }}>{label}</span>
      <span style={{ font: t.label, color: c.text }}>{value}</span>
    </div>
  );
}

function GalleryLightbox({
  images,
  name,
  index,
  onChange,
  onClose,
}: {
  images: string[];
  name: string;
  index: number;
  onChange: (i: number) => void;
  onClose: () => void;
}) {
  const total = images.length;
  const prev = () => onChange((index - 1 + total) % total);
  const next = () => onChange((index + 1) % total);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* header */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.4)',
        }}
      >
        <span style={{ font: f(600, 13), color: 'rgba(255,255,255,0.7)' }}>
          {name} · {index + 1} / {total}
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            font: f(400, 22),
            cursor: 'pointer',
            lineHeight: 1,
            padding: '4px 8px',
          }}
        >
          ✕
        </button>
      </div>

      {/* main image */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 8px', width: '100%', maxWidth: 900 }}
      >
        <NavBtn onClick={prev} label="‹" disabled={total <= 1} />

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <img
            src={images[index]}
            alt={`${name} ${index + 1}`}
            style={{
              maxWidth: '100%',
              maxHeight: 'calc(100vh - 120px)',
              objectFit: 'contain',
              borderRadius: radius.md,
            }}
          />
        </div>

        <NavBtn onClick={next} label="›" disabled={total <= 1} />
      </div>

      {/* thumbnail strip */}
      {total > 1 && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            display: 'flex',
            gap: 4,
            overflowX: 'auto',
            padding: '8px 16px',
            background: 'rgba(0,0,0,0.5)',
            scrollbarWidth: 'none',
          }}
        >
          {images.map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              onClick={() => onChange(i)}
              style={{
                width: 60,
                height: 44,
                objectFit: 'cover',
                borderRadius: radius.sm,
                border: `2px solid ${i === index ? '#fff' : 'transparent'}`,
                opacity: i === index ? 1 : 0.55,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NavBtn({ onClick, label, disabled }: { onClick: () => void; label: string; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'rgba(255,255,255,0.12)',
        border: 'none',
        color: '#fff',
        font: f(300, 32),
        width: 44,
        height: 44,
        borderRadius: '50%',
        cursor: disabled ? 'default' : 'pointer',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        opacity: disabled ? 0 : 1,
      }}
    >
      {label}
    </button>
  );
}
