/**
 * 自研 SVG 图表：折线、横向条形、环图、混淆矩阵。
 * 不引入任何第三方图表库；颜色全部来自设计 token。
 */
import { Fragment, useState } from 'react';

const SERIES_COLORS = ['var(--primary)', 'var(--info)', 'var(--warn)', 'var(--danger)', 'var(--ok)'];

const SVG_W = 680;
const SVG_H = 220;
const M_LEFT = 46;
const M_RIGHT = 16;
const M_TOP = 14;
const M_BOTTOM = 26;

/* ---------------------------------- 折线图 --------------------------------- */

export interface LineSeries {
  key: string;
  label: string;
  values: Array<number | null>;
  color?: string;
}

export interface TargetLine {
  value: number;
  label?: string;
}

function padDomain(min: number, max: number): { min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (max === min) return { min: min - 1, max: max + 1 };
  const pad = (max - min) * 0.14;
  return { min: min - pad, max: max + pad };
}

export function LineChart({
  series,
  labels,
  targetLines = [],
  valueFormat = (value: number) => String(value),
  ariaLabel = '趋势折线图',
}: {
  series: LineSeries[];
  labels: string[];
  targetLines?: TargetLine[];
  valueFormat?: (value: number) => string;
  ariaLabel?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const numbers: number[] = [];
  for (const item of series) {
    for (const value of item.values) {
      if (typeof value === 'number' && Number.isFinite(value)) numbers.push(value);
    }
  }
  for (const target of targetLines) {
    if (Number.isFinite(target.value)) numbers.push(target.value);
  }

  if (numbers.length === 0 || labels.length === 0) {
    return <div className="chart__empty">暂无趋势数据</div>;
  }

  const domain = padDomain(Math.min(...numbers), Math.max(...numbers));
  const plotW = SVG_W - M_LEFT - M_RIGHT;
  const plotH = SVG_H - M_TOP - M_BOTTOM;
  const count = labels.length;
  const stepX = count > 1 ? plotW / (count - 1) : 0;

  const xAt = (index: number) => (count > 1 ? M_LEFT + index * stepX : M_LEFT + plotW / 2);
  const yAt = (value: number) =>
    M_TOP + plotH - ((value - domain.min) / (domain.max - domain.min)) * plotH;

  const ticks = Array.from({ length: 5 }, (_, index) => domain.min + ((domain.max - domain.min) * index) / 4);
  const labelStep = Math.max(1, Math.ceil(count / 7));

  const activeLabel = activeIndex === null ? null : labels[activeIndex];

  return (
    <div className="chart">
      <svg
        className="chart__svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        role="img"
        aria-label={ariaLabel}
      >
        {ticks.map((tick) => (
          <g key={`tick-${tick}`}>
            <line
              className="chart__grid"
              x1={M_LEFT}
              x2={SVG_W - M_RIGHT}
              y1={yAt(tick)}
              y2={yAt(tick)}
            />
            <text className="chart__axis" x={M_LEFT - 8} y={yAt(tick) + 3} textAnchor="end">
              {valueFormat(tick)}
            </text>
          </g>
        ))}
        {labels.map((label, index) =>
          index % labelStep === 0 || index === count - 1 ? (
            <text
              key={`x-${label}-${index}`}
              className="chart__axis"
              x={xAt(index)}
              y={SVG_H - 8}
              textAnchor="middle"
            >
              {label}
            </text>
          ) : null,
        )}
        {targetLines.map((target, index) => (
          <line
            key={`target-${index}`}
            className="chart__target"
            x1={M_LEFT}
            x2={SVG_W - M_RIGHT}
            y1={yAt(target.value)}
            y2={yAt(target.value)}
          />
        ))}
        {series.map((item, seriesIndex) => {
          const color = item.color ?? SERIES_COLORS[seriesIndex % SERIES_COLORS.length] ?? 'var(--primary)';
          let path = '';
          let drawing = false;
          item.values.forEach((value, index) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) {
              drawing = false;
              return;
            }
            const command = drawing ? 'L' : 'M';
            path += `${command}${xAt(index).toFixed(1)} ${yAt(value).toFixed(1)} `;
            drawing = true;
          });
          return (
            <g key={item.key}>
              {path ? <path className="chart__line" d={path} style={{ stroke: color }} /> : null}
              {item.values.map((value, index) =>
                typeof value === 'number' && Number.isFinite(value) ? (
                  <circle
                    key={`${item.key}-${index}`}
                    className="chart__point"
                    cx={xAt(index)}
                    cy={yAt(value)}
                    r={activeIndex === index ? 4 : 2.75}
                    style={{ stroke: color }}
                  />
                ) : null,
              )}
            </g>
          );
        })}
        {labels.map((label, index) => {
          const width = count > 1 ? stepX : plotW;
          const left = count > 1 ? xAt(index) - stepX / 2 : M_LEFT;
          return (
            <rect
              key={`hit-${label}-${index}`}
              className="chart__hit"
              x={Math.max(M_LEFT, left)}
              y={M_TOP}
              width={Math.max(2, Math.min(width, SVG_W - M_RIGHT - M_LEFT))}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => {
                setActiveIndex(index);
              }}
              onMouseLeave={() => {
                setActiveIndex(null);
              }}
            />
          );
        })}
      </svg>
      {activeIndex !== null && activeLabel ? (
        <div
          className="chart__tooltip"
          style={{ left: `${Math.min(92, Math.max(8, (xAt(activeIndex) / SVG_W) * 100))}%`, top: 8, transform: 'translate(-50%, 0)' }}
        >
          <div className="chart__tooltip-title">{activeLabel}</div>
          {series.map((item, seriesIndex) => {
            const value = item.values[activeIndex];
            if (typeof value !== 'number' || !Number.isFinite(value)) return null;
            return (
              <div key={item.key} className="chart__tooltip-row">
                <span
                  className="chart__legend-dot"
                  style={{ background: item.color ?? SERIES_COLORS[seriesIndex % SERIES_COLORS.length] }}
                />
                <span>{item.label}</span>
                <strong className="tnum">{valueFormat(value)}</strong>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="chart__legend">
        {series.map((item, seriesIndex) => (
          <span key={item.key} className="chart__legend-item">
            <span
              className="chart__legend-swatch"
              style={{ background: item.color ?? SERIES_COLORS[seriesIndex % SERIES_COLORS.length] }}
            />
            {item.label}
          </span>
        ))}
        {targetLines.map((target, index) => (
          <span key={`target-legend-${index}`} className="chart__legend-item">
            <span className="chart__legend-swatch chart__legend-swatch--target" />
            {target.label ?? '目标'}
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- 横向条形 --------------------------------- */

export interface BarItem {
  key: string;
  label: string;
  value: number;
  hint?: string;
  tone?: 'primary' | 'danger' | 'warn' | 'info' | 'muted' | 'ok';
}

export function BarList({
  items,
  format = (value: number) => String(value),
  max,
  emptyText = '暂无数据',
}: {
  items: BarItem[];
  format?: (value: number) => string;
  max?: number;
  emptyText?: string;
}) {
  if (items.length === 0) return <div className="chart__empty">{emptyText}</div>;
  const maxValue = Math.max(1, max ?? Math.max(...items.map((item) => item.value)));
  return (
    <div className="bar-list">
      {items.map((item) => {
        const percent = Math.max(0, Math.min(100, (item.value / maxValue) * 100));
        return (
          <div key={item.key} className={['bar-row', item.tone ? `bar-row--${item.tone}` : ''].filter(Boolean).join(' ')}>
            <span className="bar-row__label" title={item.label}>
              {item.label}
            </span>
            <span className="bar-row__track">
              <span
                className="bar-row__fill"
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="bar-row__value tnum">
              {format(item.value)}
              {item.hint ? <span className="muted"> · {item.hint}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------- 环图 ---------------------------------- */

export interface DonutItem {
  key: string;
  label: string;
  value: number;
  color?: string;
}

const DONUT_COLORS = ['var(--danger)', 'var(--warn)', 'var(--info)', 'var(--ok)', 'var(--ink-faint)'];

const DONUT_R = 56;
const DONUT_C = 351.86; // 2πr, r=56

export function DonutChart({
  items,
  total,
  centerLabel = '合计',
  ariaLabel = '分布环图',
}: {
  items: DonutItem[];
  total?: number;
  centerLabel?: string;
  ariaLabel?: string;
}) {
  const sum = total ?? items.reduce((acc, item) => acc + item.value, 0);
  if (items.length === 0 || sum <= 0) return <div className="chart__empty">暂无分布数据</div>;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <div className="donut">
      <svg viewBox="0 0 132 132" role="img" aria-label={ariaLabel} style={{ width: '100%', height: '100%' }}>
        <circle cx="66" cy="66" r={DONUT_R} fill="none" stroke="var(--neutral-wash)" strokeWidth="16" />
        {items.map((item, index) => {
          const ratio = Math.max(0, item.value) / sum;
          const length = ratio * DONUT_C;
          const dashOffset = -offset;
          offset += length;
          return (
            <circle
              key={item.key}
              cx="66"
              cy="66"
              r={DONUT_R}
              fill="none"
              stroke={item.color ?? DONUT_COLORS[index % DONUT_COLORS.length]}
              strokeWidth="16"
              strokeDasharray={`${length} ${DONUT_C - length}`}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 66 66)"
            >
              <title>{`${item.label}：${item.value}`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="donut__center">
        <span className="donut__center-value">{sum}</span>
        <span className="donut__center-label">{centerLabel}</span>
      </div>
      </div>
      <div className="donut-legend">
        {items.map((item, index) => (
          <div key={item.key} className="donut-legend__row">
            <span
              className="donut-legend__swatch"
              style={{ background: item.color ?? DONUT_COLORS[index % DONUT_COLORS.length] }}
            />
            <span className="donut-legend__label">{item.label}</span>
            <span className="donut-legend__value tnum">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- 混淆矩阵 -------------------------------- */

export function ConfusionMatrix({
  rowLabels,
  colLabels,
  matrix,
  ariaLabel = '混淆矩阵',
}: {
  rowLabels: string[];
  colLabels: string[];
  matrix: number[][];
  ariaLabel?: string;
}) {
  return (
    <div
      className="confusion"
      role="table"
      aria-label={ariaLabel}
      style={{ gridTemplateColumns: `auto repeat(${colLabels.length}, minmax(108px, 1fr))` }}
    >
      <span className="confusion__axis" role="columnheader">
        实际 \\ 预测
      </span>
      {colLabels.map((label) => (
        <span key={`col-${label}`} className="confusion__axis" role="columnheader">
          {label}
        </span>
      ))}
      {rowLabels.map((rowLabel, rowIndex) => (
        <Fragment key={`row-${rowLabel}`}>
          <span className="confusion__axis" role="rowheader">
            {rowLabel}
          </span>
          {colLabels.map((colLabel, colIndex) => {
            const value = matrix[rowIndex]?.[colIndex] ?? 0;
            const isDiagonal = rowIndex === colIndex;
            return (
              <span
                key={`cell-${rowLabel}-${colLabel}`}
                className={[
                  'confusion__cell',
                  isDiagonal ? 'confusion__cell--diag' : value > 0 ? 'confusion__cell--miss' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                role="cell"
              >
                <span className="confusion__value tnum">{value}</span>
                <span className="confusion__label">{isDiagonal ? '正确' : '错判'}</span>
              </span>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
