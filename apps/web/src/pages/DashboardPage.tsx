import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  Lightbulb,
  MessagesSquare,
} from 'lucide-react';
import {
  fetchAlerts,
  fetchBadcaseStats,
  fetchClues,
  fetchDashboardAnomalies,
  fetchDashboardSummary,
  fetchDashboardTrends,
} from '../api/client';
import { useApi } from '../hooks/useApi';
import { useAppData } from '../hooks/useAppData';
import { useQueryState } from '../hooks/useQueryState';
import { formatDateTime, formatFullDateTime, formatMonthDay, formatNumber, formatRangeLabel } from '../lib/format';
import { alertLevelTone, useLabels } from '../lib/labels';
import type { DashboardAnomaly, DashboardKpi, Range, TrendRow } from '../types';
import { KpiCard, AsyncBoundary, PageSkeleton, SectionHead, StatsStrip } from '../components/primitives';
import { Card, CardBody, CardHead, PageHeader } from '../components/primitives';
import { BarList, DonutChart, LineChart } from '../components/charts';

const KPI_LINK: Record<string, string> = {
  qcCoverage: '/qc',
  qcAccuracy: '/qc',
  badcaseCloseRate: '/badcases',
  p0ResponseMin: '/sentiment?tab=alerts',
  alertPrecision: '/sentiment?tab=alerts',
  clueCloseRate: '/clues',
  csat: '/sentiment?tab=comments',
};

function kpiTarget(kpis: DashboardKpi[], id: string): number | undefined {
  return kpis.find((kpi) => kpi.id === id)?.target;
}

function drillHref(anomaly: DashboardAnomaly): string {
  const params = new URLSearchParams(anomaly.drillFilter);
  switch (anomaly.drillType) {
    case 'qc':
      return `/qc?${params.toString()}`;
    case 'sentiment':
      params.set('tab', 'alerts');
      return `/sentiment?${params.toString()}`;
    case 'badcase':
      return `/badcases?${params.toString()}`;
    case 'clue':
      return `/clues?${params.toString()}`;
    default:
      return '/';
  }
}

function trendLabels(rows: TrendRow[]): string[] {
  return rows.map((row) => formatMonthDay(row.date));
}

export function DashboardPage() {
  const query = useQueryState();
  const rawRange = query.get('range');
  const range: Range = rawRange === '14d' || rawRange === '30d' ? rawRange : '7d';
  const labels = useLabels();
  const { meta, now } = useAppData();

  const summary = useApi(() => fetchDashboardSummary(range), [range]);
  const trends = useApi(() => fetchDashboardTrends(range), [range]);
  const anomalies = useApi(fetchDashboardAnomalies, []);
  const todos = useApi(async () => {
    const [badcaseStats, alertsNew, p0New, p1New, draftClues] = await Promise.all([
      fetchBadcaseStats(),
      fetchAlerts({ status: 'new', pageSize: 1 }),
      fetchAlerts({ status: 'new', level: 'P0', pageSize: 1 }),
      fetchAlerts({ status: 'new', level: 'P1', pageSize: 1 }),
      fetchClues({ status: 'draft', pageSize: 1 }),
    ]);
    return {
      overdue: badcaseStats.overdue,
      alertsNew: alertsNew.total,
      p0New: p0New.total,
      p1New: p1New.total,
      draftClues: draftClues.total,
    };
  }, []);

  const kpis = summary.data?.kpis ?? [];
  const rows = trends.data?.rows ?? [];
  const distribution = summary.data?.distribution;
  const volume = summary.data?.volume;
  const quality = summary.data?.quality;

  const tagItems = (distribution?.tags ?? []).map((tag, index) => ({
    key: tag.code ?? `tag-${index}`,
    label: tag.name ?? labels.tag(tag.code ?? '') ?? '—',
    value: tag.count ?? 0,
    tone: 'primary' as const,
  }));
  const channelItems = (distribution?.channels ?? []).map((channel, index) => ({
    key: channel.channel ?? `channel-${index}`,
    label: labels.channel(channel.channel ?? ''),
    value: channel.count ?? 0,
    tone: 'info' as const,
  }));
  const clueTargetItems = (distribution?.clueTargets ?? []).map((target, index) => ({
    key: target.target ?? `target-${index}`,
    label: labels.clueTarget(target.target ?? ''),
    value: target.count ?? 0,
    tone: 'ok' as const,
  }));
  const alertLevelItems = (distribution?.alertLevels ?? []).map((level) => ({
    key: level.level ?? 'unknown',
    label: labels.alertLevel(level.level ?? ''),
    value: level.count ?? 0,
    color: `var(--${alertLevelTone(level.level ?? 'P2') === 'danger' ? 'danger' : alertLevelTone(level.level ?? 'P2') === 'warn' ? 'warn' : 'info'})`,
  }));

  const todoRows = [
    {
      key: 'review',
      icon: <ClipboardCheck size={15} />,
      label: '待复核质检',
      value: volume?.reviewPending ?? 0,
      unit: '条',
      to: '/qc?review=pending',
    },
    {
      key: 'overdue',
      icon: <AlertTriangle size={15} />,
      label: '超期 badcase',
      value: todos.data?.overdue ?? 0,
      unit: '条',
      to: '/badcases',
    },
    {
      key: 'alerts',
      icon: <MessagesSquare size={15} />,
      label: '未响应 P0 / P1 预警',
      value: (todos.data?.p0New ?? 0) + (todos.data?.p1New ?? 0),
      unit: '条',
      to: '/sentiment?tab=alerts&status=new',
    },
    {
      key: 'clues',
      icon: <Lightbulb size={15} />,
      label: '草稿线索',
      value: todos.data?.draftClues ?? 0,
      unit: '条',
      to: '/clues?status=draft',
    },
  ];

  return (
    <>
      <PageHeader
        title="运营总览"
        subtitle="质量水位、舆情风险与闭环进度一屏掌握；点击任一指标进入对应处理队列。"
        meta={
          <span className="text-12 muted">
            统计窗口 {formatRangeLabel(range)} · 生成于 {formatDateTime(summary.data?.generatedAt)}
          </span>
        }
      />

      <AsyncBoundary
        loading={summary.loading}
        error={summary.error}
        onRetry={summary.refresh}
        skeleton={<PageSkeleton />}
      >
        <div className="kpi-grid">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} to={KPI_LINK[kpi.id]} />
          ))}
        </div>

        {quality ? (
          <div className="dashboard-inline-stats">
            <StatsStrip
              items={[
                { label: '平均质检分', value: formatNumber(quality.avgScore, 1), aside: '分', key: 'score' },
                {
                  label: '违规率',
                  value: formatNumber((quality.violationRate ?? 0) * 100, 1),
                  aside: '%',
                  key: 'violation',
                },
                { label: '会话总量', value: formatNumber(volume?.conversations, 0), aside: '通', key: 'conv' },
                { label: '未闭环线索', value: formatNumber(volume?.cluesOpen, 0), aside: '条', key: 'clues' },
              ]}
            />
          </div>
        ) : null}

        <div className="grid-2" style={{ marginTop: 'var(--sp-5)' }}>
          <Card>
            <CardHead
              title="异常与风险"
              subtitle="按偏差排序，最多展示 4 条；点击进入对应处理队列"
              bordered
              actions={<span className="text-12 muted">共 {anomalies.data?.length ?? 0} 条</span>}
            />
            <CardBody>
              {anomalies.error ? (
                <p className="text-13 muted">异常项加载失败，可稍后重试。</p>
              ) : anomalies.loading ? (
                <p className="text-13 muted">加载中…</p>
              ) : (anomalies.data ?? []).length === 0 ? (
                <div className="dashboard-ok">
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <div>
                    <div className="dashboard-ok__title">当前无异常</div>
                    <div className="text-12 muted">全部指标位于目标区间内，继续保持。</div>
                  </div>
                </div>
              ) : (
                <ul className="anomaly-list">
                  {(anomalies.data ?? []).slice(0, 4).map((anomaly) => (
                    <li key={anomaly.id}>
                      <Link
                        className={['anomaly-row', anomaly.severity === 'bad' ? 'anomaly-row--bad' : '']
                          .filter(Boolean)
                          .join(' ')}
                        to={drillHref(anomaly)}
                      >
                        <div className="anomaly-row__main">
                          <span className="anomaly-row__metric">{anomaly.metricLabel}</span>
                          <span className="text-12 muted">
                            当前 <strong className="tnum">{formatNumber(anomaly.current, anomaly.current < 5 ? 2 : 0)}</strong>
                            {' · '}目标 {formatNumber(anomaly.target, anomaly.target < 5 ? 2 : 0)}
                            {' · '}偏差 {formatNumber(anomaly.deviation * 100, 1)}%
                          </span>
                          <span className="anomaly-row__suggestion">{anomaly.suggestion}</span>
                        </div>
                        <div className="anomaly-row__side">
                          <span className="text-12 muted">{anomaly.owner}</span>
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHead
              title="待办"
              subtitle="按当前演示时刻计算，点击进入待处理列表"
              bordered
              actions={
                todos.error ? <span className="text-12" style={{ color: 'var(--danger)' }}>统计失败</span> : null
              }
            />
            <CardBody>
              <div className="todo-list">
                {todoRows.map((row) => (
                  <Link key={row.key} className="todo-row" to={row.to}>
                    <span className="todo-row__icon">{row.icon}</span>
                    <span className="todo-row__label">{row.label}</span>
                    <span className="todo-row__count tnum">{row.value}</span>
                    <span className="text-12 muted">{row.unit}</span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                ))}
              </div>
              {todos.data?.alertsNew ? (
                <p className="text-12 muted" style={{ marginTop: 'var(--sp-3)' }}>
                  其中待确认预警共 {todos.data.alertsNew} 条，P0 {todos.data.p0New} 条、P1 {todos.data.p1New} 条。
                </p>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <SectionHead title="趋势" hint={`最近 ${range === '30d' ? 30 : range === '14d' ? 14 : 7} 天`} />
        <div className="grid-2">
          <Card>
            <CardHead
              title="质检质量"
              subtitle="质检覆盖率与质检准确率"
              bordered
              actions={<span className="text-12 muted">{formatRangeLabel(range)}</span>}
            />
            <CardBody>
              {trends.loading ? (
                <p className="text-13 muted">加载中…</p>
              ) : trends.error ? (
                <p className="text-13 muted">趋势数据加载失败。</p>
              ) : (
                <LineChart
                  ariaLabel="质检覆盖率与准确率趋势"
                  labels={trendLabels(rows)}
                  valueFormat={(value) => `${formatNumber(value * 100, 0)}%`}
                  series={[
                    { key: 'qcCoverage', label: '质检覆盖率', values: rows.map((row) => row.qcCoverage ?? null) },
                    { key: 'qcAccuracy', label: '质检准确率', values: rows.map((row) => row.qcAccuracy ?? null) },
                  ]}
                  targetLines={[
                    ...(kpiTarget(kpis, 'qcCoverage') !== undefined
                      ? [{ value: kpiTarget(kpis, 'qcCoverage') ?? 0, label: '覆盖率目标' }]
                      : []),
                    ...(kpiTarget(kpis, 'qcAccuracy') !== undefined
                      ? [{ value: kpiTarget(kpis, 'qcAccuracy') ?? 0, label: '准确率目标' }]
                      : []),
                  ]}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHead
              title="舆情与闭环"
              subtitle="P0 首响时长与预警准确率"
              bordered
              actions={<span className="text-12 muted">{formatRangeLabel(range)}</span>}
            />
            <CardBody>
              {trends.loading ? (
                <p className="text-13 muted">加载中…</p>
              ) : trends.error ? (
                <p className="text-13 muted">趋势数据加载失败。</p>
              ) : (
                <div className="grid-2">
                  <LineChart
                    ariaLabel="P0 首响时长趋势"
                    labels={trendLabels(rows)}
                    valueFormat={(value) => formatNumber(value, 0)}
                    series={[
                      {
                        key: 'p0ResponseMin',
                        label: 'P0 首响（分钟）',
                        values: rows.map((row) => row.p0ResponseMin ?? null),
                        color: 'var(--warn)',
                      },
                    ]}
                    targetLines={
                      kpiTarget(kpis, 'p0ResponseMin') !== undefined
                        ? [{ value: kpiTarget(kpis, 'p0ResponseMin') ?? 0, label: '目标' }]
                        : []
                    }
                  />
                  <LineChart
                    ariaLabel="预警准确率趋势"
                    labels={trendLabels(rows)}
                    valueFormat={(value) => `${formatNumber(value * 100, 0)}%`}
                    series={[
                      {
                        key: 'alertPrecision',
                        label: '预警准确率',
                        values: rows.map((row) => row.alertPrecision ?? null),
                        color: 'var(--info)',
                      },
                    ]}
                    targetLines={
                      kpiTarget(kpis, 'alertPrecision') !== undefined
                        ? [{ value: kpiTarget(kpis, 'alertPrecision') ?? 0, label: '目标' }]
                        : []
                    }
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <SectionHead title="分布" />
        <div className="grid-3">
          <Card>
            <CardHead title="质检标签" subtitle="违规标签命中分布" bordered />
            <CardBody>
              <BarList items={tagItems} />
            </CardBody>
          </Card>
          <Card>
            <CardHead title="预警级别" subtitle="当前窗口内预警构成" bordered />
            <CardBody>
              {alertLevelItems.length === 0 ? (
                <p className="text-13 muted">暂无预警数据</p>
              ) : (
                <DonutChart
                  items={alertLevelItems}
                  total={alertLevelItems.reduce((sum, item) => sum + item.value, 0)}
                  centerLabel="预警"
                />
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHead title="渠道与线索目标" subtitle="会话来源 / 线索流向" bordered />
            <CardBody>
              <div className="stack-3">
                <BarList items={channelItems} emptyText="暂无渠道数据" />
                <div className="divider" />
                <BarList items={clueTargetItems} emptyText="暂无线索数据" />
              </div>
            </CardBody>
          </Card>
        </div>

        <footer className="dashboard-foot">
          <span>数据版本 {meta?.demo.datasetVersion ?? '—'}</span>
          <span>规则引擎 {meta?.modelVersion ?? '—'}</span>
          <span>演示时刻 {formatFullDateTime(new Date(now).toISOString())}</span>
        </footer>
      </AsyncBoundary>
    </>
  );
}
