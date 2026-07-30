import type { CSSProperties, ReactNode } from 'react';
import { c, f, radius } from '../theme';

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
  padding = 22,
}: {
  children: ReactNode;
  style?: CSSProperties;
  padding?: number;
}) {
  return (
    <div
      style={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: radius.lg,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 18,
      }}
    >
      <span style={{ font: f(700, 16), color: c.text }}>{children}</span>
      {right}
    </div>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────────

export function Pill({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <span
      style={{
        padding: '4px 11px',
        background: bg,
        color: fg,
        borderRadius: radius.sm,
        font: f(700, 11),
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'success';

const BUTTON_STYLES: Record<ButtonVariant, CSSProperties> = {
  primary: { background: c.accent, color: '#fff', border: 'none' },
  ghost: { background: '#fff', color: c.soft, border: `1px solid ${c.border}` },
  danger: { background: c.dangerBg, color: c.dangerFg, border: `1px solid #F8C5B2` },
  success: { background: '#6E7B4E', color: '#fff', border: 'none' },
};

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  size = 'md',
  style,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  type?: 'button' | 'submit';
  size?: 'sm' | 'md' | 'lg';
  style?: CSSProperties;
  title?: string;
}) {
  const pad = size === 'sm' ? '7px 12px' : size === 'lg' ? '14px 20px' : '10px 16px';
  const fs = size === 'sm' ? 12 : size === 'lg' ? 14 : 13;

  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: pad,
        borderRadius: radius.md,
        font: f(700, fs),
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'filter .15s',
        ...BUTTON_STYLES[variant],
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.filter = 'brightness(0.94)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'none';
      }}
    >
      {children}
    </button>
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export const inputStyle: CSSProperties = {
  width: '100%',
  padding: 13,
  background: c.bg,
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  font: f(500, 14),
  color: c.text,
  outline: 'none',
  boxSizing: 'border-box',
};

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ font: f(600, 13), color: c.text, display: 'block', marginBottom: 8 }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ font: f(400, 11), color: c.muted, display: 'block', marginTop: 6 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'ຄົ້ນຫາ...',
  width = 260,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number | string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#fff',
        border: `1px solid ${c.border}`,
        borderRadius: radius.md,
        padding: '9px 14px',
        width,
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flex: 'none' }}>
        <circle cx="11" cy="11" r="7" stroke={c.faint} strokeWidth="1.8" />
        <path d="M20 20l-3.5-3.5" stroke={c.faint} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          font: f(400, 13),
          color: c.text,
          width: '100%',
        }}
      />
    </div>
  );
}

// ── Filter chips ─────────────────────────────────────────────────────────────

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            style={{
              padding: '8px 14px',
              borderRadius: radius.sm,
              font: f(600, 12),
              cursor: 'pointer',
              background: on ? c.accent : '#fff',
              color: on ? '#fff' : c.soft,
              border: `1px solid ${on ? c.accent : c.border}`,
            }}
          >
            {o.label}
            {o.count !== undefined && (
              <span style={{ opacity: 0.75, marginLeft: 6 }}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  keyOf,
  onRowClick,
  empty = 'ບໍ່ມີຂໍ້ມູນ',
  loading,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: string;
  loading?: boolean;
}) {
  if (loading) return <TableSkeleton columns={columns.length} />;
  if (!rows.length) return <EmptyState message={empty} />;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: c.rowHover }}>
            {columns.map((col, i) => (
              <th
                key={col.key}
                style={{
                  textAlign: col.align ?? 'left',
                  padding: i === 0 ? '12px 22px' : i === columns.length - 1 ? '12px 22px' : '12px',
                  font: f(600, 12),
                  color: c.muted,
                  width: col.width,
                  whiteSpace: 'nowrap',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={keyOf(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={{
                borderBottom: `1px solid ${c.divider}`,
                cursor: onRowClick ? 'pointer' : 'default',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = c.rowHover;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {columns.map((col, i) => (
                <td
                  key={col.key}
                  style={{
                    padding:
                      i === 0 ? '14px 22px' : i === columns.length - 1 ? '14px 22px' : '14px',
                    textAlign: col.align ?? 'left',
                    font: f(400, 13),
                    color: c.soft,
                    verticalAlign: 'middle',
                  }}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <div style={{ padding: 22 }}>
      {Array.from({ length: 6 }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
          {Array.from({ length: columns }).map((__, i) => (
            <div
              key={i}
              style={{
                height: 14,
                flex: i === 0 ? 0.6 : 1,
                background: c.divider,
                borderRadius: 4,
                animation: 'laostayPulse 1.3s ease-in-out infinite',
                animationDelay: `${(r * columns + i) * 0.04}s`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div style={{ padding: '56px 22px', textAlign: 'center' }}>
      <div style={{ font: f(600, 15), color: c.muted, marginBottom: 6 }}>{message}</div>
      {hint && <div style={{ font: f(400, 13), color: c.faint }}>{hint}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'ເກີດຂໍ້ຜິດພາດ';
  return (
    <Card style={{ borderColor: '#F8C5B2', background: c.dangerBg }}>
      <div style={{ font: f(700, 14), color: c.dangerFg, marginBottom: 6 }}>
        ໂຫຼດຂໍ້ມູນບໍ່ໄດ້
      </div>
      <div style={{ font: f(400, 13), color: c.soft, marginBottom: onRetry ? 14 : 0 }}>
        {message}
      </div>
      {onRetry && (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          ລອງໃໝ່
        </Button>
      )}
    </Card>
  );
}

// ── Pagination ───────────────────────────────────────────────────────────────

export function Pagination({
  page,
  pages,
  total,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) {
    return (
      <div style={{ padding: '14px 22px', font: f(400, 12), color: c.muted }}>
        ທັງໝົດ {total} ລາຍການ
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '14px 22px',
        borderTop: `1px solid ${c.divider}`,
      }}
    >
      <span style={{ font: f(400, 12), color: c.muted }}>
        ໜ້າ {page} / {pages} · ທັງໝົດ {total} ລາຍການ
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          ← ກ່ອນໜ້າ
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          ຖັດໄປ →
        </Button>
      </div>
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  title,
  children,
  onClose,
  footer,
  width = 460,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(40,30,20,.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: radius.lg,
          width,
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 30px 70px -20px rgba(40,30,20,.5)',
        }}
      >
        <div
          style={{
            padding: '18px 22px',
            borderBottom: `1px solid ${c.divider}`,
            font: f(700, 16),
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

// ── Avatar ───────────────────────────────────────────────────────────────────

export function Avatar({
  gradient,
  size = 36,
  label,
}: {
  gradient: string;
  size?: number;
  label?: string;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: gradient,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        font: f(700, Math.round(size * 0.4)),
      }}
    >
      {label}
    </div>
  );
}
