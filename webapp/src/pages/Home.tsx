import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { c, f, radius, space, type as t, TAP, MAX_WIDTH } from '../theme';
import { Section, Skeleton } from '../components/ui';
import { PropertyCard } from '../components/PropertyCard';
import { SearchBar, blankCriteria, type SearchCriteria } from '../components/SearchBar';
import type { HomeContent, Province, SearchResult } from '../lib/types';

export function HomePage() {
  const navigate = useNavigate();

  const featured = useQuery({
    queryKey: ['home', 'featured'],
    queryFn: () => api.get<SearchResult>('/properties' + qs({ sort: 'rating', limit: 6 })),
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

  function search(criteria: SearchCriteria) {
    navigate(
      '/search' +
        qs({
          q: criteria.q,
          provinceId: criteria.provinceId,
          checkIn: criteria.checkIn,
          checkOut: criteria.checkOut,
          guests: criteria.guests,
        }),
    );
  }

  // Only provinces that actually have somewhere to stay — a tile leading to an
  // empty result set is worse than no tile.
  const withStock = (provinces.data ?? []).filter((p) => p.propertyCount > 0).slice(0, 8);

  return (
    <div>
      <section
        style={{
          background: `linear-gradient(150deg, ${c.darkSoft}, ${c.dark} 70%)`,
          padding: `${space[5]}px 18px ${space[6]}px`,
        }}
      >
        <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto' }}>
          {/* Fluid rather than fixed: 34px is right on a laptop and wraps the
              headline onto three lines of a 390px phone, taking the hero past
              280px tall before a guest has seen anything bookable. */}
          <h1
            style={{
              font: f(800, 34, 44),
              fontSize: 'clamp(24px, 5.2vw, 34px)',
              lineHeight: 1.28,
              color: '#fff',
              margin: `0 0 ${space[2]}px`,
              maxWidth: 560,
            }}
          >
            ຈອງທີ່ພັກທົ່ວລາວ
          </h1>
          <p
            style={{
              font: t.body,
              fontSize: 'clamp(13.5px, 2.6vw, 15px)',
              color: c.onDark,
              margin: 0,
              maxWidth: 500,
            }}
          >
            ໂຮມສະເຕ, ເຮືອນພັກ, ຣີສອດ ແລະ ວິນລ່າ — ຈ່າຍດ້ວຍ QR ຜ່ານແອັບທະນາຄານ
          </p>
        </div>
      </section>

      <div style={{ maxWidth: MAX_WIDTH, margin: `-${space[6]}px auto 0`, padding: '0 18px' }}>
        <SearchBar value={blankCriteria()} onSearch={search} />
      </div>

      <div style={{ maxWidth: MAX_WIDTH, margin: '0 auto', padding: `${space[6]}px 18px 0` }}>
        {cms.data?.announcements.map((a) => (
          <div
            key={a.id}
            data-testid="announcement"
            style={{
              background: c.infoBg,
              border: `1px solid ${c.border}`,
              borderRadius: radius.md,
              padding: '13px 16px',
              marginBottom: 12,
            }}
          >
            <div style={{ font: t.bodySm, color: c.infoFg }}>{a.title}</div>
            {a.content && (
              <div style={{ font: f(400, 12.5, 20), color: c.soft, marginTop: 3 }}>{a.content}</div>
            )}
          </div>
        ))}

        {!!cms.data?.banners.length && (
          <div
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              margin: '6px 0 30px',
            }}
          >
            {cms.data.banners.map((b) => (
              <Banner key={b.id} banner={b} />
            ))}
          </div>
        )}

        <Section
          title="ຄະແນນສູງສຸດ"
          right={
            <button
              onClick={() => navigate('/search')}
              style={{
                background: 'none',
                border: 'none',
                minHeight: TAP,
                padding: `0 ${space[2]}px`,
                font: t.label,
                color: c.accent,
                cursor: 'pointer',
              }}
            >
              ເບິ່ງທັງໝົດ →
            </button>
          }
        >
          <div
            style={{
              display: 'grid',
              gap: 18,
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            }}
          >
            {featured.isLoading
              ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={318} />)
              : featured.data?.items.map((item) => (
                  <PropertyCard key={item.id} item={item} to={`/property/${item.id}`} />
                ))}
          </div>
        </Section>

        <Section title="ຈຸດໝາຍຍອດນິຍົມ">
          {provinces.isLoading ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} height={40} width={120} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {withStock.map((p) => (
                <button
                  key={p.id}
                  onClick={() => navigate('/search' + qs({ provinceId: p.id }))}
                  style={{
                    minHeight: TAP,
                    padding: `0 ${space[4]}px`,
                    background: c.bg,
                    border: `1px solid ${c.border}`,
                    borderRadius: 999,
                    font: t.label,
                    color: c.text,
                    cursor: 'pointer',
                  }}
                >
                  {p.name}
                  <span style={{ color: c.faint }}> · {p.propertyCount}</span>
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="ຈອງແນວໃດ">
          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <Step n={1} title="ຄົ້ນຫາ" body="ເລືອກແຂວງ ວັນທີ່ ແລະ ຈຳນວນຄົນ — ຜົນລັບສະແດງສະເພາະຫ້ອງທີ່ວ່າງຈິງ" />
            <Step n={2} title="ຈອງ" body="ເລືອກຫ້ອງ ແລ້ວກົດຈອງ — ຫ້ອງຈະຖືກກັນໄວ້ໃຫ້ 15 ນາທີ" />
            <Step n={3} title="ຈ່າຍດ້ວຍ QR" body="ສະແກນ QR ຜ່ານແອັບທະນາຄານ — ຢືນຢັນທັນທີເມື່ອຈ່າຍສຳເລັດ" />
          </div>
        </Section>
      </div>
    </div>
  );
}

/**
 * A promotional banner.
 *
 * `target_type` is polymorphic with no foreign key behind it, so only the one
 * kind this app can actually open — a property — becomes a link. A banner
 * pointing at a promotion or at `url` renders as plain copy rather than a link
 * that goes nowhere.
 */
function Banner({ banner }: { banner: HomeContent['banners'][number] }) {
  const body = (
    <>
      {banner.imageUrl && (
        <div
          style={{
            height: 132,
            background: `url(${banner.imageUrl}) center/cover`,
            borderBottom: `1px solid ${c.border}`,
          }}
        />
      )}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ font: f(700, 14.5), color: c.text }}>{banner.title}</div>
        {banner.description && (
          <div style={{ font: f(400, 12.5, 20), color: c.muted, marginTop: 4 }}>
            {banner.description}
          </div>
        )}
      </div>
    </>
  );

  const style = {
    display: 'block',
    background: '#fff',
    border: `1px solid ${c.border}`,
    borderRadius: radius.lg,
    overflow: 'hidden',
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

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: radius.lg,
        padding: 18,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: '50%',
          background: c.accent,
          color: '#fff',
          display: 'grid',
          placeItems: 'center',
          font: f(800, 14),
          marginBottom: 12,
        }}
      >
        {n}
      </div>
      <div style={{ font: f(700, 15), color: c.text, marginBottom: 5 }}>{title}</div>
      <div style={{ font: t.bodySm, color: c.muted }}>{body}</div>
    </div>
  );
}
