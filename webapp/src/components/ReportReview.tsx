import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { reportReview, type ReportReason } from '../lib/api';
import { c, f, radius } from '../theme';
import { Button, ErrorNote, Field, inputStyle, Modal } from './ui';

const REASONS: { value: ReportReason; label: string; hint: string }[] = [
  { value: 'fake', label: 'ຮີວິວປອມ', hint: 'ບໍ່ເຄີຍມາພັກຈິງ' },
  { value: 'offensive', label: 'ຄຳຫຍາບຄາຍ', hint: 'ດູໝິ່ນ ຫຼື ຄຸກຄາມ' },
  { value: 'spam', label: 'ສະແປມ ຫຼື ໂຄສະນາ', hint: 'ບໍ່ກ່ຽວກັບທີ່ພັກ' },
  { value: 'other', label: 'ອື່ນໆ', hint: '' },
];

/**
 * Reporting a review.
 *
 * Shown to anyone signed in, not only the host: the guest named in an abusive
 * reply has as much reason to complain as the property does. Reporting hides
 * nothing — a moderator decides — so the wording promises review, not removal.
 */
export function ReportReview({ reviewId }: { reviewId: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('fake');
  const [detail, setDetail] = useState('');
  const [done, setDone] = useState(false);

  const send = useMutation({
    mutationFn: () => reportReview(reviewId, reason, detail.trim() || undefined),
    onSuccess: () => {
      setOpen(false);
      setDone(true);
    },
  });

  if (!user) return null;

  if (done) {
    return (
      <div style={{ font: f(500, 11.5), color: c.muted, marginTop: 10 }}>
        ໄດ້ຮັບລາຍງານແລ້ວ — ທີມງານຈະກວດສອບ
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          marginTop: 10,
          font: f(500, 11.5),
          color: c.faint,
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        ລາຍງານຮີວິວນີ້
      </button>

      {open && (
        <Modal
          title="ລາຍງານຮີວິວ"
          width={440}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={send.isPending}>
                ຍົກເລີກ
              </Button>
              <Button disabled={send.isPending} onClick={() => send.mutate()}>
                {send.isPending ? 'ກຳລັງສົ່ງ...' : 'ສົ່ງລາຍງານ'}
              </Button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Says plainly what reporting does, so nobody expects the review to
                disappear when they press the button. */}
            <p style={{ font: f(400, 12.5, 19), color: c.muted, margin: 0 }}>
              ທີມງານຈະກວດສອບ. ຮີວິວຍັງສະແດງຢູ່ຈົນກວ່າຈະມີການຕັດສິນ.
            </p>

            <div style={{ display: 'grid', gap: 8 }}>
              {REASONS.map((r) => (
                <label
                  key={r.value}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: radius.md,
                    border: `1px solid ${reason === r.value ? c.accent : c.border}`,
                    background: reason === r.value ? c.accentSoft : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="reason"
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    style={{ accentColor: c.accent }}
                  />
                  <span>
                    <span style={{ font: f(600, 13), color: c.text }}>{r.label}</span>
                    {r.hint && (
                      <span style={{ font: f(400, 11.5), color: c.faint }}> · {r.hint}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>

            <Field label="ລາຍລະອຽດ" hint="ບໍ່ບັງຄັບ">
              <input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                maxLength={1000}
                style={inputStyle}
              />
            </Field>

            {send.error != null && <ErrorNote error={send.error} />}
          </div>
        </Modal>
      )}
    </>
  );
}
