import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../lib/api';
import { c, f, radius, type as typ } from '../theme';
import { laoAgo, laoTime } from '../lib/format';
import { Button, Empty, ErrorNote, Loading, Page, PageTitle, Skeleton } from '../components/ui';
import type { ChatMessage, Conversation } from '../lib/types';

/** How often an open thread asks for anything newer than its cursor. */
const POLL_MS = 5000;

export function MessagesPage() {
  const query = useQuery({
    queryKey: ['conversations'],
    queryFn: () =>
      api.get<{ items: Conversation[]; unreadTotal: number }>('/customer/conversations'),
    refetchInterval: 30_000,
  });

  return (
    <Page width="narrow">
      <PageTitle>ຂໍ້ຄວາມ</PageTitle>

      {query.isError && <ErrorNote error={query.error} onRetry={() => void query.refetch()} />}

      {query.isLoading ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} height={78} />
          ))}
        </div>
      ) : query.data?.items.length ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {query.data.items.map((t) => (
            <Link
              key={t.id}
              to={`/messages/${t.id}`}
              style={{
                display: 'flex',
                gap: 13,
                padding: 15,
                background: t.unread ? c.accentSoft : c.surface,
                border: `1px solid ${t.unread ? '#F8C9B4' : c.border}`,
                borderRadius: radius.lg,
                color: 'inherit',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ font: f(t.unread ? 800 : 700, 14), color: c.text }}>
                    {t.property}
                  </span>
                  {t.bookingCode && (
                    <span style={{ font: typ.caption, color: c.faint }}>{t.bookingCode}</span>
                  )}
                  <span style={{ marginLeft: 'auto', font: typ.caption, color: c.faint }}>
                    {laoAgo(t.lastMessageAt)}
                  </span>
                </div>
                <div
                  style={{
                    font: typ.caption,
                    color: t.unread ? c.text : c.muted,
                    fontStyle: t.lastMessage === null ? 'italic' : undefined,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {/* A deleted message keeps its place but has no text. */}
                  {t.lastMessage === null
                    ? 'ຂໍ້ຄວາມຖືກລຶບແລ້ວ'
                    : `${t.lastMessageMine ? 'ທ່ານ: ' : ''}${t.lastMessage}`}
                </div>
              </div>

              {t.unread > 0 && (
                <span
                  style={{
                    alignSelf: 'center',
                    minWidth: 20,
                    height: 20,
                    padding: '0 6px',
                    borderRadius: 10,
                    background: c.accent,
                    color: '#fff',
                    font: typ.caption,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {t.unread}
                </span>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          icon="💬"
          message="ຍັງບໍ່ມີຂໍ້ຄວາມ"
          hint="ຖາມທີ່ພັກໄດ້ຈາກໜ້າທີ່ພັກ ຫຼື ໜ້າການຈອງ — ບໍ່ຈຳເປັນຕ້ອງຈອງກ່ອນ"
          action={
            <Link to="/search">
              <Button size="lg">ຄົ້ນຫາທີ່ພັກ</Button>
            </Link>
          }
        />
      )}
    </Page>
  );
}

/**
 * One thread.
 *
 * Polls with an id cursor rather than a timestamp: two messages written in the
 * same millisecond would make a time cursor either skip one or repeat it.
 */
export function ThreadPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  const thread = useQuery({
    queryKey: ['conversation', id],
    queryFn: () => api.get<Conversation & { customerName: string }>(`/customer/conversations/${id}`),
  });

  // The first page. Everything after it arrives through the poll below.
  const initial = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api.get<{ items: ChatMessage[] }>(`/customer/conversations/${id}/messages`),
  });

  useEffect(() => {
    if (!initial.data) return;
    setMessages(initial.data.items);
    const last = initial.data.items.at(-1);
    if (last) setCursor(last.id);
  }, [initial.data]);

  // Opening the thread is reading it.
  useEffect(() => {
    if (!id) return;
    void api.post(`/customer/conversations/${id}/read`).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    });
  }, [id, queryClient]);

  useEffect(() => {
    if (!cursor) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.get<{ items: ChatMessage[] }>(
          `/customer/conversations/${id}/messages${qs({ since: cursor })}`,
        );
        if (!res.items.length) return;
        setMessages((current) => [...current, ...res.items]);
        setCursor(res.items[res.items.length - 1].id);
        // Anything that arrives while the thread is open is read on arrival.
        await api.post(`/customer/conversations/${id}/read`);
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch {
        // A dropped poll is not worth an error banner — the next tick retries
        // and what is already on screen is still valid.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [cursor, id, queryClient]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = useMutation({
    mutationFn: (text: string) =>
      api.post<ChatMessage>(`/customer/conversations/${id}/messages`, { text }),
    onSuccess: (message) => {
      setMessages((current) => [...current, message]);
      setCursor(message.id);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft('');
    send.mutate(text, {
      // Put it back rather than lose what they wrote.
      onError: () => setDraft(text),
    });
  }

  if (initial.isLoading) return <Loading />;
  if (initial.isError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorNote error={initial.error} onRetry={() => void initial.refetch()} />
      </div>
    );
  }

  const closed = thread.data?.status === 'closed';

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '18px 18px 0',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - 200px)',
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <Link to="/messages" style={{ font: typ.label, color: c.muted }}>
          ← ຂໍ້ຄວາມທັງໝົດ
        </Link>
        <h1 style={{ font: typ.h2, color: c.text, margin: '10px 0 2px' }}>
          {thread.data?.property ?? '—'}
        </h1>
        {thread.data?.propertyId && (
          <Link
            to={`/property/${thread.data.propertyId}`}
            style={{ font: typ.caption }}
          >
            ເບິ່ງໜ້າທີ່ພັກ →
          </Link>
        )}
      </div>

      <div style={{ flex: 1, display: 'grid', gap: 6, alignContent: 'start', paddingBottom: 16 }}>
        {messages.length === 0 && (
          <div style={{ font: typ.bodySm, color: c.muted, textAlign: 'center', padding: 30 }}>
            ຍັງບໍ່ມີຂໍ້ຄວາມ — ຖາມສິ່ງທີ່ຢາກຮູ້ໄດ້ເລີຍ
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              maxWidth: '78%',
              alignSelf: m.mine ? 'flex-end' : 'flex-start',
              background: m.isDeleted ? c.neutralBg : m.mine ? c.accent : c.bg,
              border: m.mine || m.isDeleted ? 'none' : `1px solid ${c.border}`,
              borderRadius: m.mine
                ? `${radius.lg}px ${radius.lg}px 4px ${radius.lg}px`
                : `${radius.lg}px ${radius.lg}px ${radius.lg}px 4px`,
              padding: '9px 13px',
            }}
          >
            <div
              style={{
                font: f(400, 13.5, 21),
                fontStyle: m.isDeleted ? 'italic' : undefined,
                color: m.isDeleted ? c.neutralFg : m.mine ? '#fff' : c.text,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.isDeleted ? 'ຂໍ້ຄວາມຖືກລຶບແລ້ວ' : m.text}
            </div>
            <div
              style={{
                font: f(400, 10),
                marginTop: 3,
                color: m.mine && !m.isDeleted ? 'rgba(255,255,255,.75)' : c.faint,
              }}
            >
              {laoTime(m.createdAt)}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {closed ? (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: c.neutralBg,
            color: c.neutralFg,
            padding: 14,
            borderRadius: radius.md,
            font: typ.caption,
            textAlign: 'center',
            marginBottom: 18,
          }}
        >
          ການສົນທະນານີ້ປິດແລ້ວ
        </div>
      ) : (
        <form
          onSubmit={submit}
          style={{
            position: 'sticky',
            bottom: 0,
            background: c.surface,
            borderTop: `1px solid ${c.border}`,
            padding: '12px 0',
            display: 'flex',
            gap: 10,
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ພິມຂໍ້ຄວາມ..."
            maxLength={4000}
            style={{
              flex: 1,
              padding: '12px 14px',
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: radius.md,
              font: typ.body,
              color: c.text,
            }}
          />
          <Button type="submit" disabled={send.isPending || !draft.trim()}>
            ສົ່ງ
          </Button>
        </form>
      )}

      {send.isError && (
        <div style={{ paddingBottom: 18 }}>
          <ErrorNote error={send.error} />
        </div>
      )}
    </div>
  );
}

/**
 * "Message the host" — opens the thread, or reuses the one already open.
 *
 * The API returns the existing conversation rather than creating a second, so
 * this is safe to press twice.
 */
export function useStartConversation() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { propertyId: string; bookingId?: string }) =>
      api.post<Conversation>('/customer/conversations', input),
    onSuccess: (conversation) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      navigate(`/messages/${conversation.id}`);
    },
  });
}
