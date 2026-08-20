import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { c, radius, type as t } from '../theme';
import { laoAgo } from '../lib/format';
import type { ReplyNode, ReviewThread } from '../lib/types';

/**
 * The host's answer to a review.
 *
 * Fetched per review rather than embedded in the property page, because most
 * reviews have no reply and loading a reply thread for each of fifty of them
 * would cost more than it shows. `staleTime` is long: a public reply changes
 * about once.
 */
export function ReviewReplies({ reviewId }: { reviewId: string }) {
  const { data } = useQuery({
    queryKey: ['review', reviewId],
    queryFn: () => api.get<ReviewThread>(`/reviews/${reviewId}`),
    staleTime: 5 * 60 * 1000,
  });

  if (!data?.replies.length) return null;

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      {data.replies.map((reply) => (
        <Reply key={reply.id} reply={reply} depth={0} />
      ))}
    </div>
  );
}

function Reply({ reply, depth }: { reply: ReplyNode; depth: number }) {
  return (
    <div
      style={{
        // Indented once, then flat. A review thread that steps in five times is
        // unreadable on a phone, so deeper replies simply line up with their
        // grandparent.
        marginLeft: depth > 0 ? 16 : 0,
        paddingLeft: 12,
        borderLeft: `2px solid ${c.accentSoft}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
        <span style={{ font: t.label, color: c.accentDark }}>{reply.author}</span>
        <span style={{ font: t.caption, color: c.faint }}>{laoAgo(reply.createdAt)}</span>
      </div>
      <div
        style={{
          font: t.caption,
          color: c.soft,
          background: c.bg,
          borderRadius: radius.sm,
          padding: '8px 11px',
        }}
      >
        {reply.text}
      </div>

      {reply.children.map((child) => (
        <div key={child.id} style={{ marginTop: 8 }}>
          <Reply reply={child} depth={Math.min(depth + 1, 1)} />
        </div>
      ))}
    </div>
  );
}
