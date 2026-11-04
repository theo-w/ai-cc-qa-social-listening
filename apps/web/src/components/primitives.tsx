import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Info,
  Inbox,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { errorMessage } from '../api/client';
import type { DashboardKpi } from '../types';
import type { Tone } from '../lib/labels';
import { formatNumber, formatSigned } from '../lib/format';

/* -------------------------------- Spinner -------------------------------- */

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="btn__spinner"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/* --------------------------------- Button -------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline' | 'text';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  loading?: boolean;
  block?: boolean;
  leftIcon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  block = false,
  leftIcon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${variant}`, size === 'sm' ? 'btn--sm' : '', block ? 'btn--block' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner size={14} /> : leftIcon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={['icon-btn', className].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Badge --------------------------------- */

export interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  outline?: boolean;
  large?: boolean;
  className?: string;
  title?: string;
}

export function Badge({ tone = 'muted', children, dot = true, outline = false, large = false, className, title }: BadgeProps) {
  const classes = [
    'badge',
    `badge--${tone}`,
    outline ? 'badge--outline' : '',
    large ? 'badge--lg' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} title={title}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function CountPill({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <span className={['count-pill', danger ? 'count-pill--danger' : ''].filter(Boolean).join(' ')}>{children}</span>;
}

export function Chip({ tone, children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={['chip', tone ? `chip--${tone}` : ''].filter(Boolean).join(' ')} title={title}>{children}</span>;
}

/* ---------------------------------- Card --------------------------------- */

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return <Tag className={['card', className].filter(Boolean).join(' ')}>{children}</Tag>;
}

export function CardHead({
  title,
  subtitle,
  actions,
  bordered = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  bordered?: boolean;
}) {
  return (
    <div className={['card__head', bordered ? 'card__head--bordered' : ''].filter(Boolean).join(' ')}>
      <div>
        <h2 className="card__title">{title}</h2>
        {subtitle ? <div className="card__subtitle">{subtitle}</div> : null}
      </div>
      {actions ? <div className="card__actions">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ children, flush = false }: { children: ReactNode; flush?: boolean }) {
  return <div className={['card__body', flush ? 'card__body--flush' : ''].filter(Boolean).join(' ')}>{children}</div>;
}

export function CardFoot({ children }: { children: ReactNode }) {
  return <div className="card__foot">{children}</div>;
}

/* ------------------------------- PageHeader ------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
  meta,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head__main">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        {meta ? <div className="page-head__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHead({
  title,
  hint,
  actions,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2 className="section-head__title">
        {title}
        {hint ? <span className="section-head__hint">{hint}</span> : null}
      </h2>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

/* --------------------------------- KpiCard -------------------------------- */

function kpiParts(kpi: DashboardKpi): { value: string; unit: string } {
  switch (kpi.unit) {
    case 'percent':
      return { value: formatNumber(kpi.value * 100, 1), unit: '%' };
    case 'min':
      return { value: formatNumber(kpi.value, 0), unit: '分钟' };
    case 'sec':
      return { value: formatNumber(kpi.value, 0), unit: '秒' };
    case 'score':
      return { value: formatNumber(kpi.value, 1), unit: '分' };
    case 'count':
    default:
      return { value: formatNumber(kpi.value, 0), unit: '条' };
  }
}

function kpiTargetText(kpi: DashboardKpi): string {
  if (kpi.unit === 'percent') return `${kpi.op} ${formatNumber(kpi.target * 100, 1)}%`;
  if (kpi.unit === 'min') return `${kpi.op} ${formatNumber(kpi.target, 0)} 分钟`;
  if (kpi.unit === 'sec') return `${kpi.op} ${formatNumber(kpi.target, 0)} 秒`;
  if (kpi.unit === 'score') return `${kpi.op} ${formatNumber(kpi.target, 1)} 分`;
  return `${kpi.op} ${formatNumber(kpi.target, 0)}`;
}

function kpiDeltaTone(kpi: DashboardKpi): 'ok' | 'bad' | 'flat' {
  if (!Number.isFinite(kpi.delta) || kpi.delta === 0) return 'flat';
  const good = kpi.op === '>=' ? kpi.delta > 0 : kpi.delta < 0;
  return good ? 'ok' : 'bad';
}

export function KpiCard({ kpi, to }: { kpi: DashboardKpi; to?: string }) {
  const parts = kpiParts(kpi);
  const deltaTone = kpiDeltaTone(kpi);
  const body = (
    <>
      <span className="kpi-card__label">{kpi.label}</span>
      <span className="kpi-card__value">
        {parts.value}
        {parts.unit ? <span className="kpi-card__unit">{parts.unit}</span> : null}
      </span>
      <span className="kpi-card__foot">
        <span>目标 {kpiTargetText(kpi)}</span>
        <span className={`kpi-card__delta kpi-card__delta--${deltaTone}`}>
          {deltaTone === 'flat' ? (
            '持平'
          ) : (
            <>
              {deltaTone === 'ok' ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {formatSigned(kpi.delta, kpi.unit)}
            </>
          )}
        </span>
      </span>
    </>
  );
  const className = ['kpi-card', `kpi-card--${kpi.status}`].join(' ');
  if (to) {
    return (
      <Link className={className} to={to} title={kpi.hint ?? undefined}>
        {body}
      </Link>
    );
  }
  return (
    <div className={className} title={kpi.hint ?? undefined}>
      {body}
    </div>
  );
}

/* -------------------------------- StatsStrip ------------------------------- */

export interface StatItem {
  label: ReactNode;
  value: ReactNode;
  aside?: ReactNode;
  key?: string;
}

export function StatsStrip({ items }: { items: StatItem[] }) {
  return (
    <div className="stats-strip">
      {items.map((item, index) => (
        <div className="stat-cell" key={item.key ?? index}>
          <span className="stat-cell__label">{item.label}</span>
          <span className="stat-cell__value">{item.value}</span>
          {item.aside ? <span className="stat-cell__aside">{item.aside}</span> : null}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- Progress -------------------------------- */

export function ProgressBar({
  value,
  max = 100,
  tone,
  thin = false,
}: {
  value: number;
  max?: number;
  tone?: 'ok' | 'warn' | 'danger';
  thin?: boolean;
}) {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const classes = [
    'progress',
    thin ? 'progress--thin' : '',
    tone ? `progress--${tone}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__bar" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function ScoreLine({ score, max = 100 }: { score: number; max?: number }) {
  const tone = score < 60 ? 'danger' : score < 80 ? 'warn' : 'ok';
  return (
    <span className="score-line">
      <span className="score-line__num">{formatNumber(score, 0)}</span>
      <ProgressBar value={score} max={max} tone={tone} thin />
    </span>
  );
}

/* ---------------------------------- KV ----------------------------------- */

export function KV({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv__label">{label}</span>
      <span className="kv__value">{children}</span>
    </div>
  );
}

export function DefRow({ dt, children }: { dt: ReactNode; children: ReactNode }) {
  return (
    <div className="def-row">
      <dt className="def-row__dt">{dt}</dt>
      <dd className="def-row__dd">{children}</dd>
    </div>
  );
}

/* --------------------------------- Callout -------------------------------- */

export function Callout({
  variant = 'info',
  children,
  icon,
}: {
  variant?: 'info' | 'warn' | 'danger' | 'ok';
  children: ReactNode;
  icon?: ReactNode;
}) {
  const fallbackIcon =
    variant === 'danger' || variant === 'warn' ? (
      <AlertTriangle size={15} />
    ) : variant === 'ok' ? (
      <CheckCircle2 size={15} />
    ) : (
      <Info size={15} />
    );
  return (
    <div className={`callout callout--${variant}`}>
      {icon ?? fallbackIcon}
      <div>{children}</div>
    </div>
  );
}

/* -------------------------------- Skeletons ------------------------------- */

export function Skeleton({
  width,
  height = 12,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={['skeleton', className].filter(Boolean).join(' ')}
      style={{ display: 'block', width, height, ...style }}
    />
  );
}

export function SkeletonLines({ count = 3, gap = 10 }: { count?: number; gap?: number }) {
  const widths = ['92%', '78%', '64%', '86%', '70%'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} width={widths[index % widths.length]} height={12} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <div className="skeleton" style={{ height: 38, borderRadius: 0 }} />
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <Skeleton width="80%" />
          <Skeleton width="60%" />
          <Skeleton width="50%" />
          <Skeleton width="40%" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="加载中">
      <Skeleton width={180} height={24} />
      <Skeleton width={320} height={14} />
      <div className="grid-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={76} style={{ borderRadius: 10 }} />
        ))}
      </div>
      <Skeleton height={320} style={{ borderRadius: 10 }} />
    </div>
  );
}

/* ------------------------------ States ----------------------------------- */

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="state-block">
      <div className="state-block__icon">{icon ?? <Inbox size={19} />}</div>
      <div className="state-block__title">{title}</div>
      {description ? <p className="state-block__desc">{description}</p> : null}
      {action ? <div className="state-block__actions">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = '加载失败',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="state-block state-block--error" role="alert">
      <div className="state-block__icon">
        <AlertCircle size={19} />
      </div>
      <div className="state-block__title">{title}</div>
      <p className="state-block__desc">{errorMessage(error)}</p>
      {onRetry ? (
        <div className="state-block__actions">
          <Button variant="secondary" size="sm" leftIcon={<RotateCcw size={14} />} onClick={onRetry}>
            重新加载
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function LoadingBlock({ label = '加载中' }: { label?: string }) {
  return (
    <div className="state-block" aria-busy="true">
      <span style={{ color: 'var(--ink-muted)', display: 'grid', placeItems: 'center' }}>
        <Loader2 size={20} className="is-spinning" style={{ animation: 'spin 0.9s linear infinite' }} />
      </span>
      <p className="state-block__desc">{label}</p>
    </div>
  );
}

export function AsyncBoundary({
  loading,
  error,
  onRetry,
  skeleton,
  children,
}: {
  loading: boolean;
  error: unknown;
  onRetry?: () => void;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  if (loading && !error) return <>{skeleton ?? <LoadingBlock />}</>;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  return <>{children}</>;
}

/* -------------------------------- BackLink -------------------------------- */

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="back-link" to={to}>
      <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
      {children}
    </Link>
  );
}
