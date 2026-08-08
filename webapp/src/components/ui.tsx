import type { CSSProperties, ReactNode } from 'react';
import { c, f, radius, shadow } from '../theme';

// ── buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_PADDING: Record<ButtonSize, string> = {
  sm: '8px 14px',
  md: '11px 18px',
  lg: '15px 24px',
};

const BUTTON_FONT: Record<ButtonSize, number> = { sm: 12.5, md: 13.5, lg: 15 };

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  full,
  style,
  ...rest
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const palette: Record<ButtonVariant, CSSProperties> = {
    primary: { background: c.accent, color: '#fff', border: '1px solid transparent' },
    ghost: { background: 'transparent', color: c.soft, border: '1px solid transparent' },
    outline: { background: '#fff', color: c.text, border: `1px solid ${c.border}` },
    danger: { background: '#fff', color: c.dangerFg, border: `1px solid ${c.dangerBg}` },
  };

  return (
    <button
      {...rest}
      style={{
        ...palette[variant],
        padding: BUTTON_PADDING[size],
        borderRadius: radius.md,
        font: f(700, BUTTON_FONT[size]),
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        width: full ? '100%' : undefined,
        transition: 'filter .15s, opacity .15s',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!rest.disabled) e.currentTarget.style.filter = 'brightness(0.95)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'none';
      }}
    >
      {children}
    </button>
  );
}

// ── surfaces ─────────────────────────────────────────────────────────────────

export function Card({
  children,
  padding = 18,
  style,
  onClick,
  testId,
}: {
  children: ReactNode;
  padding?: number;
  style?: CSSProperties;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <div
      onClick={onClick}
      data-testid={testId}
      style={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: radius.lg,
        padding,
        boxShadow: shadow.card,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={{ marginBottom: 26 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h2 style={{ font: f(800, 18), color: c.text, margin: 0 }}>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Pill({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: bg,
        color: fg,
        padding: '4px 10px',
        borderRadius: 999,
        font: f(700, 11.5),
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

// ── form fields ──────────────────────────────────────────────────────────────

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: '13px 14px',
  background: '#fff',
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  font: f(500, 14),
  color: c.text,
  outline: 'none',
};

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ font: f(700, 12.5), color: c.text, display: 'block', marginBottom: 7 }}>
        {label}
      </span>
      {children}
      {error ? (
        <span style={{ font: f(500, 11.5), color: c.dangerFg, display: 'block', marginTop: 5 }}>
          {error}
        </span>
      ) : hint ? (
        <span style={{ font: f(400, 11.5), color: c.muted, display: 'block', marginTop: 5 }}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

// ── state ────────────────────────────────────────────────────────────────────

export function Spinner({ size = 20, color = c.accent }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `2px solid ${color}33`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'laostaySpin .7s linear infinite',
      }}
    />
  );
}

export function Loading({ label = 'ກຳລັງໂຫຼດ...' }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: '56px 20px',
        font: f(500, 13.5),
        color: c.muted,
      }}
    >
      <Spinner />
      {label}
    </div>
  );
}

/**
 * Shows the message the API sent.
 *
 * The backend answers in Lao and English (`ຫ້ອງເຕັມແລ້ວ · That room is fully
 * booked`) and names the dates that failed, so relaying it is far more use than
 * a generic apology.
 */
export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'ເກີດຂໍ້ຜິດພາດ';
  return (
    <div
      style={{
        background: c.dangerBg,
        border: '1px solid #F8C5B2',
        borderRadius: radius.md,
        padding: '14px 16px',
        font: f(500, 12.5, 20),
        color: c.dangerFg,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 14,
      }}
    >
      <span>{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            background: 'none',
            border: 'none',
            color: c.dangerFg,
            font: f(700, 12.5),
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
            flex: 'none',
          }}
        >
          ລອງໃໝ່
        </button>
      )}
    </div>
  );
}

export function Empty({
  icon = '🔍',
  message,
  hint,
  action,
}: {
  icon?: string;
  message: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ padding: '56px 24px', textAlign: 'center' }}>
      <div style={{ fontSize: 34, marginBottom: 14 }}>{icon}</div>
      <div style={{ font: f(700, 15), color: c.text, marginBottom: 6 }}>{message}</div>
      {hint && (
        <div style={{ font: f(400, 13, 21), color: c.muted, maxWidth: 380, margin: '0 auto' }}>
          {hint}
        </div>
      )}
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}

/** A grey block standing in for content that has not arrived yet. */
export function Skeleton({
  height = 16,
  width = '100%',
  style,
}: {
  height?: number | string;
  width?: number | string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        height,
        width,
        background: c.neutralBg,
        borderRadius: radius.sm,
        animation: 'laostayPulse 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

// ── photos ───────────────────────────────────────────────────────────────────

export function Photo({
  url,
  alt = '',
  height = 180,
  width = '100%',
  rounded = radius.md,
  style,
}: {
  url?: string | null;
  alt?: string;
  height?: number | string;
  width?: number | string;
  rounded?: number;
  style?: CSSProperties;
}) {
  if (!url) {
    return (
      <div
        style={{
          height,
          width,
          background: c.neutralBg,
          borderRadius: rounded,
          display: 'grid',
          placeItems: 'center',
          fontSize: 22,
          color: c.faint,
          ...style,
        }}
      >
        🏠
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      style={{
        height,
        width,
        objectFit: 'cover',
        borderRadius: rounded,
        display: 'block',
        background: c.neutralBg,
        ...style,
      }}
    />
  );
}

export function Stars({ value, count }: { value: number; count?: number }) {
  if (!count) {
    return <span style={{ font: f(500, 12), color: c.faint }}>ຍັງບໍ່ມີຮີວິວ</span>;
  }
  return (
    <span style={{ font: f(600, 12.5), color: c.soft }}>
      <span style={{ color: c.star }}>★</span> {value.toFixed(1)}
      <span style={{ color: c.faint }}> ({count})</span>
    </span>
  );
}

// ── layout ───────────────────────────────────────────────────────────────────

/** A bar pinned to the bottom of the viewport — the booking call to action. */
export function StickyBar({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        background: c.surface,
        borderTop: `1px solid ${c.border}`,
        boxShadow: shadow.sheet,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        zIndex: 20,
      }}
    >
      {children}
    </div>
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  width = 460,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(43,37,33,.45)',
        display: 'grid',
        placeItems: 'center',
        padding: 18,
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: c.surface,
          borderRadius: radius.lg,
          boxShadow: shadow.raised,
        }}
      >
        <div
          style={{
            padding: '18px 22px',
            borderBottom: `1px solid ${c.divider}`,
            font: f(800, 16),
            color: c.text,
          }}
        >
          {title}
        </div>
        <div style={{ padding: 22 }}>{children}</div>
        {footer && (
          <div
            style={{
              padding: '16px 22px',
              borderTop: `1px solid ${c.divider}`,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 10,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** One line of a price breakdown. */
export function MoneyRow({
  label,
  amount,
  strong,
  negative,
  note,
}: {
  label: string;
  amount: string;
  strong?: boolean;
  negative?: boolean;
  note?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        padding: '5px 0',
      }}
    >
      <span style={{ font: f(strong ? 700 : 400, strong ? 14 : 13), color: strong ? c.text : c.muted }}>
        {label}
        {note && <span style={{ font: f(400, 11.5), color: c.faint }}> · {note}</span>}
      </span>
      <span
        style={{
          font: f(strong ? 800 : 600, strong ? 16 : 13.5),
          color: negative ? c.successFg : strong ? c.accent : c.text,
          whiteSpace: 'nowrap',
        }}
      >
        {negative ? '− ' : ''}
        {amount}
      </span>
    </div>
  );
}
