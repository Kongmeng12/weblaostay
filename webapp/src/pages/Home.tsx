import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { c, f, radius, shadow, space, type as t, TAP, MAX_WIDTH } from '../theme';
import { Photo, Section, Skeleton } from '../components/ui';
import { PropertyCard } from '../components/PropertyCard';
import { laoDate, nightsBetween } from '../lib/format';
import { usePlannedStay } from '../lib/stay';
import type { HomeContent, Province, SearchResult } from '../lib/types';

/**
 * Home, laid out like the customer app's home screen — but stays first. A
 * guest lands on places they can open straight away; the search is a single
 * pill above them, and dates are asked for only once, on the property they
 * choose (and remembered after that). Offers, provinces and shortcuts follow.
 */
export function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // With a stay already chosen, home shows what is free for those nights and
  // what the whole stay costs; without one, the best-rated places.
  const planned = usePlannedStay();
  const featured = useQuery({
    queryKey: ['home', 'featured', planned],
    queryFn: () =>
      api.get<SearchResult>(
        '/properties' + qs({ sort: 'rating', limit: 9, ...(planned ? { checkIn: planned.checkIn, checkOut: planned.checkOut, guests: planned.guests } : {}) }),
      ),
  });

  // Editorial content — whatever an admin has published and scheduled for
  // today. Public, so it loads for a signed-out visitor too.
  const cms = useQuery({
    queryKey: ['content', 'home'],
    queryFn: () => api.get<HomeContent>('/content/home'),
    staleTime: 5 * 60 * 1000,
  });

  const provinces = useQuery({
    queryKey: ['provinces'],
    queryFn: () => api.get<Province[]>('/locations/provinces'),
    staleTime: 60 * 60 * 1000,
  });

  // Only provinces that actually have somewhere to stay — a tile leading to an
  // empty result set is worse than no tile.
  const withStock = (provinces.data ?? []).filter((p) => p.propertyCount > 0);
  const firstName = givenName(user?.fullName);

  return (
    <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto', padding: `${space[5]}px 18px 0` }}>
      {/* ── greeting ── */}
      <div style={{ marginBottom: space[4] }}>
        {firstName && (
          <div style={{ font: f(700, 13, 20), color: c.muted }}>ສະບາຍດີ, {firstName}</div>
        )}
        <h1
          style={{
            font: f(700, 28, 40),
            fontSize: 'clamp(22px, 4.6vw, 30px)',
            lineHeight: 1.4,
            color: c.text,
            margin: 0,
          }}
        >
          ຢາກໄປພັກຢູ່ໃສ?
        </h1>
      </div>

      {/* ── search: one tap away, but not in the way of the stays ── */}
      <Link
        to="/search"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minHeight: 52,
          padding: '6px 8px 6px 18px',
          background: c.bg,
          borderRadius: radius.pill,
          color: c.faint,
          font: t.body,
          maxWidth: 640,
        }}
      >
        <span style={{ color: c.muted, display: 'grid' }}>
          <SearchGlyph />
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ຄົ້ນຫາແຂວງ, ເມືອງ ຫຼື ບ່ອນພັກ
        </span>
        {planned && (
          <span
            style={{
              flex: 'none',
              padding: '6px 12px',
              borderRadius: radius.pill,
              background: c.surface,
              color: c.text,
              font: f(700, 12, 18),
            }}
          >
            {laoDate(planned.checkIn)} → {laoDate(planned.checkOut)}
          </span>
        )}
      </Link>

      {/* ── stays: the first thing on the page ── */}
      <div style={{ marginTop: space[5] }} />
      <Section
        title={planned ? `ວ່າງສຳລັບທ່ານ · ${nightsBetween(planned.checkIn, planned.checkOut)} ຄືນ` : 'ບ່ອນພັກແນະນຳ'}
        right={
          <button
            onClick={() => navigate('/search')}
            style={{
              background: 'none',
              border: 'none',
              minHeight: TAP,
              padding: `0 ${space[2]}px`,
              font: f(700, 13, 20),
              color: c.accent,
              cursor: 'pointer',
            }}
          >
            ເບິ່ງທັງໝົດ
          </button>
        }
      >
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }}
        >
          {featured.isLoading
            ? Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} height={290} style={{ borderRadius: radius.lg }} />
              ))
            : featured.data?.items.map((item) => (
                <PropertyCard key={item.id} item={item} to={`/property/${item.id}`} />
              ))}
        </div>
        {!featured.isLoading && featured.data?.items.length === 0 && (
          <div style={{ font: t.bodySm, color: c.muted, padding: `${space[4]}px 0` }}>
            {planned ? 'ບໍ່ມີບ່ອນພັກວ່າງໃນວັນທີ່ເລືອກ — ລອງປ່ຽນວັນທີ່ໃນໜ້າຄົ້ນຫາ' : 'ຍັງບໍ່ມີບ່ອນພັກ'}
          </div>
        )}
      </Section>

      {cms.data?.announcements.map((a) => (
        <div
          key={a.id}
          data-testid="announcement"
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            background: c.warnBg,
            borderRadius: radius.md,
            padding: '13px 16px',
            marginBottom: space[4],
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 18, lineHeight: '22px' }}>
            📣
          </span>
          <div>
            <div style={{ font: f(700, 13.5, 22), color: c.warnFg }}>{a.title}</div>
            {a.content && (
              <div style={{ font: t.caption, color: c.soft, marginTop: 2 }}>{a.content}</div>
            )}
          </div>
        </div>
      ))}

      {!!cms.data?.banners.length && (
        <div style={{ marginBottom: space[6] }}>
          <BannerCarousel banners={cms.data.banners} />
        </div>
      )}

      {/* ── regions ── */}
      <div>
        <Section title="ສຳຫຼວດແຂວງ">
          {provinces.isLoading ? (
            <div className="phaphak-rail">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} height={118} style={{ borderRadius: 20 }} />
              ))}
            </div>
          ) : withStock.length ? (
            <div className="phaphak-rail">
              {withStock.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate('/search' + qs({ provinceId: p.id }))}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    textAlign: 'center',
                    cursor: 'pointer',
                    minWidth: 0,
                  }}
                >
                  <Photo url={p.imageUrl} alt="" height={80} rounded={20} />
                  <div
                    style={{
                      font: f(700, 12.5, 20),
                      color: c.text,
                      marginTop: 8,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.name}
                  </div>
                  <div style={{ font: f(400, 11, 16), color: c.muted }}>{p.propertyCount} ບ່ອນພັກ</div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ font: t.bodySm, color: c.muted }}>ຍັງບໍ່ມີແຂວງທີ່ມີບ່ອນພັກ</div>
          )}
        </Section>
      </div>

      {/* ── shortcuts (the app's main-screen row) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 10,
          marginBottom: space[6],
        }}
      >
        <Shortcut to="/trips" label="ການຈອງຂອງຂ້ອຍ" icon={<CalendarGlyph />} />
        <Shortcut to="/wishlist" label="ທີ່ມັກ" icon={<HeartGlyph />} />
        <Shortcut to="/help" label="ຊ່ວຍເຫຼືອ" icon={<HelpGlyph />} />
      </div>

      {/* ── for hosts: the app's filled service card ── */}
      <PartnerCard />

      <Section title="ຈອງແນວໃດ">
        <div
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          <Step n={1} title="ຄົ້ນຫາ" body="ເລືອກແຂວງ ວັນທີ່ ແລະ ຈຳນວນຄົນ — ຜົນລັບສະແດງສະເພາະຫ້ອງທີ່ວ່າງຈິງ" />
          <Step n={2} title="ຈອງ" body="ເລືອກຫ້ອງ ແລ້ວກົດຈອງ — ຫ້ອງຈະຖືກກັນໄວ້ໃຫ້ 15 ນາທີ" />
          <Step n={3} title="ຈ່າຍດ້ວຍ QR" body="ສະແກນ QR ຜ່ານແອັບທະນາຄານ — ຢືນຢັນທັນທີເມື່ອຈ່າຍສຳເລັດ" />
        </div>
      </Section>
    </div>
  );
}

/**
 * The name to greet someone by: the first word of their name, skipping a title
 * in front of it — "ທ້າວ ສົມພອນ ແກ້ວ" is greeted as ສົມພອນ, not ທ້າວ.
 */
function givenName(fullName: string | null | undefined): string | undefined {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1 && TITLES.has(words[0].toLowerCase())) words.shift();
  return words[0];
}

const TITLES = new Set(['ທ້າວ', 'ນາງ', 'ທ່ານ', 'mr.', 'mrs.', 'ms.', 'miss', 'mr', 'mrs', 'ms', 'dr.']);

// ── banners ─────────────────────────────────────────────────────────────────

type Banner = HomeContent['banners'][number];

/**
 * The app's `PromoBannerCarousel`: full-bleed photo slides with the title on
 * a dark scrim, advancing every five seconds, with the stretched dot for the
 * current one. Built on scroll-snap, so a swipe or a trackpad moves it too;
 * the timer pauses while the pointer is over it.
 */
function BannerCarousel({ banners }: { banners: Banner[] }) {
  const strip = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (banners.length < 2 || paused) return;
    const id = window.setInterval(() => {
      const el = strip.current;
      if (!el) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % banners.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, 5000);
    return () => window.clearInterval(id);
  }, [banners.length, paused]);

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div
        ref={strip}
        className="phaphak-strip"
        onScroll={(e) => {
          const el = e.currentTarget;
          setPage(Math.round(el.scrollLeft / el.clientWidth));
        }}
        style={{ display: 'flex', borderRadius: radius.lg }}
      >
        {banners.map((b) => (
          <BannerSlide key={b.id} banner={b} />
        ))}
      </div>
      {banners.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10 }}>
          {banners.map((b, i) => (
            <span
              key={b.id}
              style={{
                height: 6,
                width: i === page ? 20 : 6,
                borderRadius: 3,
                background: i === page ? c.accent : c.border,
                transition: 'width .25s ease, background .25s ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One slide. `target_type` is polymorphic with no foreign key behind it, so
 * only the one kind this app can actually open — a property — becomes a link.
 */
function BannerSlide({ banner }: { banner: Banner }) {
  const body = (
    <>
      <Photo url={banner.imageUrl} alt="" height="100%" rounded={0} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,.7), rgba(0,0,0,0) 85%)',
        }}
      />
      <div style={{ position: 'absolute', left: 20, right: 20, bottom: 18 }}>
        <div style={{ font: f(700, 19, 28), color: '#fff' }}>{banner.title}</div>
        {banner.description && (
          <div
            style={{
              font: f(500, 12.5, 20),
              color: 'rgba(255,255,255,.9)',
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {banner.description}
          </div>
        )}
      </div>
    </>
  );

  const style = {
    position: 'relative',
    flex: '0 0 100%',
    height: 'clamp(172px, 28vw, 260px)',
    scrollSnapAlign: 'start',
    overflow: 'hidden',
    borderRadius: radius.lg,
    display: 'block',
  } as const;

  if (banner.targetType === 'property' && banner.targetId) {
    return (
      <Link to={`/property/${banner.targetId}`} data-testid="banner" style={style}>
        {body}
      </Link>
    );
  }
  return (
    <div data-testid="banner" style={style}>
      {body}
    </div>
  );
}

// ── small pieces ────────────────────────────────────────────────────────────

function Shortcut({ to, label, icon }: { to: string; label: string; icon: ReactNode }) {
  return (
    <Link
      to={to}
      className="phaphak-lift"
      style={{
        height: 92,
        padding: '0 8px',
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: 18,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: c.text,
        minWidth: 0,
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          background: c.accentSoft,
          color: c.accent,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {icon}
      </span>
      <span
        style={{
          font: f(700, 12, 18),
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </Link>
  );
}

function PartnerCard() {
  return (
    <Link
      to="/partner-register"
      style={{
        position: 'relative',
        display: 'block',
        overflow: 'hidden',
        margin: `${space[2]}px 0 ${space[6]}px`,
        padding: 22,
        borderRadius: radius.lg,
        background: `linear-gradient(135deg, ${c.accent}, ${c.accentDark})`,
        boxShadow: '0 10px 22px -6px rgba(255,87,34,.4)',
        color: '#fff',
      }}
    >

      <div style={{ position: 'relative', maxWidth: 560 }}>
        <div style={{ font: f(800, 20, 30), marginBottom: 4 }}>ທ່ານມີທີ່ພັກ ຫຼື ຄອນໂດ?</div>
        <div style={{ font: f(400, 13, 22), color: 'rgba(255,255,255,.88)', marginBottom: 14 }}>
          ລົງທະບຽນກັບ Phapai — ຮັບການຈອງ 24/7, ລາຍໄດ້ທຸກອາທິດ, ຈັດການຜ່ານແອັບ
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 36,
            padding: '0 16px',
            borderRadius: radius.pill,
            background: '#fff',
            color: c.accent,
            font: f(800, 13, 20),
          }}
        >
          ສະໝັກ Partner →
        </span>
      </div>
    </Link>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div
      style={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: 18,
        padding: 18,
        boxShadow: shadow.card,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: '50%',
          background: c.accentSoft,
          color: c.accent,
          display: 'grid',
          placeItems: 'center',
          font: f(800, 14),
          marginBottom: 12,
        }}
      >
        {n}
      </div>
      <div style={{ font: t.h3, color: c.text, marginBottom: 4 }}>{title}</div>
      <div style={{ font: t.bodySm, color: c.muted }}>{body}</div>
    </div>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SearchGlyph() {
  return (
    <Glyph>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Glyph>
  );
}

function CalendarGlyph() {
  return (
    <Glyph>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Glyph>
  );
}

function HeartGlyph() {
  return (
    <Glyph>
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.3 1.1 5 3 1.7-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" />
    </Glyph>
  );
}

function HelpGlyph() {
  return (
    <Glyph>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <rect x="3" y="13.5" width="4" height="6" rx="1.5" />
      <rect x="17" y="13.5" width="4" height="6" rx="1.5" />
      <path d="M19 19.5c0 1-1.5 2-4 2h-2" />
    </Glyph>
  );
}
