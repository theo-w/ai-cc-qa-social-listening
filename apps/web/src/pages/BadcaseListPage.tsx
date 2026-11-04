import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FilterX } from 'lucide-react';
import { fetchBadcaseList, fetchBadcaseStats } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useQueryState } from '../hooks/useQueryState';
import { severityTone, useLabels, withAll } from '../lib/labels';
import { formatDateTime, formatNumber, formatRatio } from '../lib/format';
import type { BadcaseCategory, BadcaseStatus } from '../types';
import { Badge, Button, EmptyState, ErrorState, PageHeader, StatsStrip } from '../components/primitives';
import { FilterBar, FilterGroup, Select } from '../components/forms';
import { DataTable, Pagination } from '../components/table';
import type { Column } from '../components/table';

const PAGE_SIZE = 20;
const STATUS_VALUES: BadcaseStatus[] = ['open', 'in_progress', 'pending_verify', 'closed'];
const CATEGORY_VALUES: BadcaseCategory[] = ['knowledge', 'script', 'process', 'system'];

const STATUS_LABELS: Record<BadcaseStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  pending_verify: '待验证',
  closed: '已闭环',
};

const CATEGORY_LABELS: Record<BadcaseCategory, string> = {
  knowledge: '知识缺失',
  script: '话术问题',
  process: '流程问题',
  system: '系统问题',
};

export function BadcaseListPage() {
  const navigate = useNavigate();
  const labels = useLabels();
  const query = useQueryState();

  const status = query.get('status') as BadcaseStatus | undefined;
  const category = query.get('category') as BadcaseCategory | undefined;
  const page = query.getNumber('page', 1);

  const stats = useApi(() => fetchBadcaseStats(), []);
  const list = useApi(() => fetchBadcaseList({ page, pageSize: PAGE_SIZE, status, category }), [page, status, category]);

  const setFilter = (patch: Record<string, string | number | undefined>) => {
    query.setParams({ ...patch, page: undefined });
  };

  const activeFilterCount = [status, category].filter(Boolean).length;

  const columns: Array<Column<any>> = [
    { key: 'code', header: '编号', render: (row) => <span className="mono">{row.code}</span> },
    { key: 'title', header: '标题', render: (row) => <span>{row.title}</span> },
    { key: 'category', header: '归因', render: (row) => <Badge tone="info">{labels.badcaseCategory(row.category)}</Badge> },
    { key: 'status', header: '状态', render: (row) => <Badge tone={row.status === 'closed' ? 'ok' : row.overdue ? 'danger' : 'warn'}>{STATUS_LABELS[row.status as BadcaseStatus]}</Badge> },
    { key: 'severity', header: '严重', render: (row) => <Badge tone={severityTone(row.severity)}>{row.severity}</Badge> },
    { key: 'owner', header: '责任人', render: (row) => <span>{row.owner}</span> },
    { key: 'dueAt', header: '截止', render: (row) => <span className={row.overdue ? 'text-danger' : ''}>{formatDateTime(row.dueAt)}</span> },
    { key: 'recurrence', header: '复发', render: (row) => row.recurrence ? <Badge tone="danger">是</Badge> : <span className="muted">—</span> },
    {
      key: 'actions',
      header: '操作',
      center: true,
      render: (row) => (
        <Button variant="text" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/badcases/${row.id}`); }}>
          详情
        </Button>
      ),
    },
  ];

  const statItems = stats.data
    ? [
        { label: '总数', value: formatNumber(stats.data.total, 0), key: 'total' },
        { label: '待处理', value: formatNumber(stats.data.open, 0), key: 'open' },
        { label: '处理中', value: formatNumber(stats.data.inProgress, 0), key: 'inProgress' },
        { label: '待验证', value: formatNumber(stats.data.pendingVerify, 0), key: 'pendingVerify' },
        { label: '已闭环', value: formatNumber(stats.data.closed, 0), key: 'closed' },
        { label: '闭环率', value: formatRatio(stats.data.closeRate), key: 'closeRate' },
        { label: '复发率', value: formatRatio(stats.data.recurrenceRate), key: 'recurrenceRate' },
        { label: '已逾期', value: formatNumber(stats.data.overdue, 0), key: 'overdue' },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="badcase 管理"
        subtitle="跟踪问题归因、分派、整改与复发，形成闭环。"
        actions={
          <Button variant="secondary" size="sm" leftIcon={<FilterX size={14} />} onClick={() => { query.reset(); }}>
            清空筛选
          </Button>
        }
      />

      {stats.error ? (
        <p className="text-13" style={{ marginBottom: 16, color: 'var(--danger)' }}>统计加载失败：{stats.error}</p>
      ) : (
        <StatsStrip items={statItems} />
      )}

      <FilterBar>
        <FilterGroup label="状态">
          <Select
            value={status ?? ''}
            options={withAll(STATUS_VALUES.map((s) => ({ value: s, label: STATUS_LABELS[s] })), '全部状态')}
            onChange={(value) => setFilter({ status: value || undefined })}
          />
        </FilterGroup>
        <FilterGroup label="归因">
          <Select
            value={category ?? ''}
            options={withAll(CATEGORY_VALUES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })), '全部归因')}
            onChange={(value) => setFilter({ category: value || undefined })}
          />
        </FilterGroup>
      </FilterBar>

      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refresh} title="badcase 列表加载失败" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={list.loading && !list.data}
            onRowClick={(row) => navigate(`/badcases/${row.id}`)}
            empty={
              <EmptyState
                title="没有符合条件的 badcase"
                description="尝试放宽筛选条件。"
                action={
                  activeFilterCount > 0 ? (
                    <Button variant="secondary" size="sm" onClick={() => { query.reset(); }}>清空筛选</Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={list.refresh} leftIcon={<ArrowUpRight size={14} />}>重新加载</Button>
                  )
                }
              />
            }
          />
          {list.data && list.data.total > PAGE_SIZE ? (
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onChange={(next) => query.setParams({ page: next })}
            />
          ) : null}
        </>
      )}
    </>
  );
}
