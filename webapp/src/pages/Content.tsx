import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { c, f, radius } from '../theme';
import { laoDateFull } from '../lib/format';
import { ErrorNote, Loading } from '../components/ui';
import type { AppPage, FaqGroup } from '../lib/types';

/**
 * Help — the FAQs, as the admin wrote them.
 *
 * Grouped by category on the server, so the order is the one an editor chose
 * rather than whatever the database returned.
 */
export function HelpPage() {
  const query = useQuery({
    queryKey: ['content', 'faqs'],
    queryFn: () => api.get<FaqGroup[]>('/content/faqs'),
    staleTime: 10 * 60 * 1000,
  });

  if (query.isLoading) return <Loading />;
  if (query.isError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const groups = query.data ?? [];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '30px 18px 56px' }}>
      <h1 style={{ font: f(800, 26), color: c.text, margin: '0 0 6px' }}>ຊ່ວຍເຫຼືອ</h1>
      <p style={{ font: f(400, 13.5, 22), color: c.muted, margin: '0 0 26px' }}>
        ຄຳຖາມທີ່ຖືກຖາມເລື້ອຍທີ່ສຸດ. ຍັງບໍ່ພົບຄຳຕອບ? ທັກຫາທີ່ພັກໄດ້ໂດຍກົງຈາກໜ້າການຈອງ.
      </p>

      {!groups.length && (
        <div style={{ font: f(400, 13), color: c.muted }}>ຍັງບໍ່ມີຄຳຖາມທີ່ພົບເລື້ອຍ</div>
      )}

      {groups.map((group) => (
        <section key={group.category} style={{ marginBottom: 28 }}>
          <h2 style={{ font: f(700, 16), color: c.text, margin: '0 0 10px' }}>{group.category}</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            {group.items.map((item) => (
              <Faq key={item.id} question={item.question} answer={item.answer} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        border: `1px solid ${c.border}`,
        borderRadius: radius.md,
        background: open ? c.bg : '#fff',
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          padding: '14px 16px',
          background: 'none',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          font: f(600, 13.5, 21),
          color: c.text,
        }}
      >
        <span>{question}</span>
        <span style={{ font: f(400, 15), color: c.faint, flex: 'none' }}>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div
          style={{
            padding: '0 16px 15px',
            font: f(400, 13, 22),
            color: c.soft,
            whiteSpace: 'pre-wrap',
          }}
        >
          {answer}
        </div>
      )}
    </div>
  );
}

/**
 * A static page — terms, privacy, about.
 *
 * The API 404s a page that is not published rather than returning an empty
 * body, so a missing page says so instead of showing a blank "Terms of
 * Service" that a guest might take as the real thing.
 */
export function StaticPage() {
  const { slug = '' } = useParams();

  const query = useQuery({
    queryKey: ['content', 'page', slug],
    queryFn: () => api.get<AppPage>(`/content/pages/${slug}`),
    staleTime: 10 * 60 * 1000,
  });

  if (query.isLoading) return <Loading />;
  if (query.isError) {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '40px 18px' }}>
        <ErrorNote error={query.error} onRetry={() => void query.refetch()} />
        <div style={{ marginTop: 18 }}>
          <Link to="/" style={{ font: f(600, 13) }}>
            ← ກັບໜ້າຫຼັກ
          </Link>
        </div>
      </div>
    );
  }

  const page = query.data!;

  return (
    <article style={{ maxWidth: 700, margin: '0 auto', padding: '30px 18px 56px' }}>
      <h1 style={{ font: f(800, 26, 36), color: c.text, margin: '0 0 8px' }}>{page.title}</h1>
      {page.updatedAt && (
        <div style={{ font: f(400, 12), color: c.faint, marginBottom: 24 }}>
          ແກ້ໄຂລ່າສຸດ {laoDateFull(page.updatedAt)}
        </div>
      )}
      <div style={{ font: f(400, 14, 25), color: c.soft, whiteSpace: 'pre-wrap' }}>
        {page.content}
      </div>
    </article>
  );
}

/**
 * The footer's list of published pages.
 *
 * Read from the index rather than hard-coded, so a link never points at a page
 * the admin has not published — `/content/pages` returns only the live ones.
 */
export function usePublishedPages() {
  const { data } = useQuery({
    queryKey: ['content', 'pages'],
    queryFn: () => api.get<{ slug: string; title: string }[]>('/content/pages'),
    staleTime: 30 * 60 * 1000,
  });
  return data ?? [];
}
