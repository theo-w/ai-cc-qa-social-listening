import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FilterX } from 'lucide-react';
import { fetchQcConversations, fetchQcStats } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSearchParamInput, useQueryState } from '../hooks/useQueryState';
import { useAppData } from '../hooks/useAppData';
import {
  CHANNEL_LABELS,
  VERDICT_LABELS,
  dictOptions,
  emotionTone,
  severityTone,
  useLabels,
  verdictTone,
  withAll,
} from '../lib/labels';
import { formatDateTime, formatNumber, formatRatio } from '../lib/format';
import type {
  Channel,
  ConversationListItem,
  QcSort,
  QcTagCode,
  Range,
  ReviewFilter,
  Verdict,
} from '../types';
import { Badge, Button, EmptyState, ErrorState, PageHeader, ScoreLine, StatsStrip } from '../components/primitives';
import { FilterBar, FilterGroup, SearchInput, Select, Switch } from '../components/forms';
import { DataTable, Pagination } from '../components/table';
import type { Column } from '../components/table';

const PAGE_SIZE = 20;

const VERDICT_VALUES: Verdict[] = ['pass', 'violation'];
const REVIEW_VALUES: ReviewFilter[] = ['pending', 'done', 'none'];
const CHANNEL_VALUES: Channel[] = ['online', 'ticket', 'phone'];
const SORT_VALUES: QcSort[] = ['time_desc', 'time_asc', 'score_desc', 'score_asc'];

const SORT_OPTIONS = [
  { value: 'time_desc', label: '开始时间（新→旧）' },
  { value: 'time_asc', label: '开始时间（旧→新）' },
  { value: 'score_desc', label: '评分（高→低）' },
  { value: 'score_asc', label: '评分（低→高）' },
];

function pick<T extends string>(raw: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function QcListPage() {
  const navigate = useNavigate();
  const labels = useLabels();
  const { meta } = useAppData();
  const query = useQueryState();
  const [qInput, setQInput] = useSearchParamInput('q');

  const rangeParam = query.get('range');
  const range: Range = rangeParam === '14d' || rangeParam === '30d' ? rangeParam : '7d';
  const verdict = pick(query.get('verdict'), VERDICT_VALUES);
  const review = pick(query.get('review'), REVIEW_VALUES);
  const channel = pick(query.get('channel'), CHANNEL_VALUES);
  const sort = pick(query.get('sort'), SORT_VALUES);
  const tagRaw = query.get('tag');
  const tag = tagRaw ? (tagRaw as QcTagCode) : undefined;
  const page = query.getNumber('page', 1);

  const stats = useApi(() => fetchQcStats(range), [range]);
  const list = useApi(
    () =>
      fetchQcConversations({
        q: qInput,
        page,
        pageSize: PAGE_SIZE,
        verdict,
        tag,
        review,
        channel,
        sort,
      }),
    [qInput, page, verdict, tag, review, channel, sort],
  );

  const [onlyPending, setOnlyPending] = useState(review === 'pending');
  useEffect(() => {
    setOnlyPending(review === 'pending');
  }, [review]);

  const setFilter = (patch: Record<string, string | number | undefined>) => {
    query.setParams({ ...patch, page: undefined });
  };

  const activeFilterCount = [verdict, tag, review, channel, sort && sort !== 'time_desc' ? sort : undefined].filter(Boolean).length;

  const columns: Array<Column<ConversationListItem>> = [
    {
      key: 'conversation',
      header: '会话',
      render: (row) => (
        <div className="cell-primary">
          <span className="mono">{row.id}</span>
          <span className="cell-primary__sub">
            {row.customerName} · {row.messageCount} 条消息
          </span>
        </div>
      ),
    },
    { key: 'channel', header: '渠道', render: (row) => labels.channel(row.channel) },
    { key: 'agent', header: '坐席', render: (row) => row.agentName },
    { key: 'product', header: '产品', render: (row) => <span className="muted">{row.product}</span> },
    { key: 'startedAt', header: '开始时间', render: (row) => <span className="tnum">{formatDateTime(row.startedAt)}</span> },
    { key: 'score', header: '评分', numeric: true, render: (row) => <ScoreLine score={row.score} /> },
    { key: 'verdict', header: '判定', render: (row) => <Badge tone={verdictTone(row.verdict)}>{labels.verdict(row.verdict)}</Badge> },
    {
      key: 'emotion',
      header: '情绪',
      render: (row) => <span className={`emotion-text emotion-text--${emotionTone(row.emotion)}`}>{labels.emotion(row.emotion)}</span>,
    },
    {
      key: 'tags',
      header: '标签',
      render: (row) => (
        <div className="chips">
          {row.tags.slice(0, 3).map((tagItem) => (
            <Badge key={tagItem.code} tone={severityTone(tagItem.severity)} dot={false}>
              {tagItem.name || labels.tag(tagItem.code)}
            </Badge>
          ))}
          {row.tags.length > 3 ? <span className="text-12 muted">+{row.tags.length - 3}</span> : null}
          {row.tags.length === 0 ? <span className="text-12 muted">—</span> : null}
        </div>
      ),
    },
    {
      key: 'review',
      header: '复核状态',
      render: (row) => (
        <Badge tone={row.needsReview ? 'warn' : 'muted'}>{row.needsReview ? '待复核' : '无需复核'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '操作',
      center: true,
      render: (row) => (
        <Button
          variant="text"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/qc/${row.id}`);
          }}
        >
          查看
        </Button>
      ),
    },
  ];

  const statItems = stats.data
    ? [
        { label: '已检测', value: formatNumber(stats.data.analyzed, 0), aside: `/ ${formatNumber(stats.data.total, 0)} 通`, key: 'analyzed' },
        {
          label: '违规率',
          value: formatRatio(stats.data.total > 0 ? stats.data.violation / stats.data.total : 0),
          aside: `${formatNumber(stats.data.violation, 0)} 通`,
          key: 'violation',
        },
        { label: '待复核', value: formatNumber(stats.data.needsReview, 0), aside: '条', key: 'review' },
        { label: '复核占比', value: formatRatio(stats.data.reviewRatio), aside: `${formatNumber(stats.data.reviewed, 0)} 条已复核`, key: 'reviewed' },
      ]
    : [
        { label: '已检测', value: '—', key: 'analyzed' },
        { label: '违规率', value: '—', key: 'violation' },
        { label: '待复核', value: '—', key: 'review' },
        { label: '复核占比', value: '—', key: 'reviewed' },
      ];

  return (
    <>
      <PageHeader
        title="质检"
        subtitle="逐通查看质检结论与证据，完成复核并沉淀 badcase。"
        actions={
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<FilterX size={14} />}
            onClick={() => {
              setQInput('');
              query.reset();
            }}
          >
            清空筛选
          </Button>
        }
      />

      {stats.error ? (
        <p className="text-13" style={{ marginBottom: 'var(--sp-3)', color: 'var(--danger)' }}>
          统计加载失败：{stats.error}
        </p>
      ) : (
        <StatsStrip items={statItems} />
      )}

      <FilterBar>
        <FilterGroup>
          <SearchInput
            value={qInput}
            onChange={setQInput}
            placeholder="搜索会话 / 客户 / 坐席"
            ariaLabel="搜索会话、客户或坐席"
          />
        </FilterGroup>
        <FilterGroup label="判定">
          <Select
            value={verdict ?? ''}
            ariaLabel="按判定筛选"
            options={withAll(dictOptions(VERDICT_LABELS), '全部判定')}
            onChange={(value) => {
              setFilter({ verdict: value || undefined });
            }}
          />
        </FilterGroup>
        <FilterGroup label="标签">
          <Select
            value={tag ?? ''}
            ariaLabel="按标签筛选"
            options={withAll(
              (meta?.tagTaxonomy ?? []).length > 0
                ? (meta?.tagTaxonomy ?? []).map((item) => ({ value: item.code, label: item.name || labels.tag(item.code) }))
                : dictOptions(VERDICT_LABELS),
              '全部标签',
            )}
            onChange={(value) => {
              setFilter({ tag: value || undefined });
            }}
          />
        </FilterGroup>
        <FilterGroup label="复核">
          <Select
            value={review ?? ''}
            ariaLabel="按复核状态筛选"
            options={[
              { value: '', label: '全部复核状态' },
              { value: 'pending', label: '待复核' },
              { value: 'done', label: '已复核' },
              { value: 'none', label: '无需复核' },
            ]}
            onChange={(value) => {
              setFilter({ review: value || undefined });
            }}
          />
        </FilterGroup>
        <FilterGroup label="渠道">
          <Select
            value={channel ?? ''}
            ariaLabel="按渠道筛选"
            options={withAll(dictOptions(CHANNEL_LABELS), '全部渠道')}
            onChange={(value) => {
              setFilter({ channel: value || undefined });
            }}
          />
        </FilterGroup>
        <FilterGroup label="排序">
          <Select
            value={sort ?? 'time_desc'}
            ariaLabel="排序方式"
            options={SORT_OPTIONS}
            onChange={(value) => {
              setFilter({ sort: value === 'time_desc' ? undefined : value });
            }}
          />
        </FilterGroup>
        <FilterGroup>
          <Switch
            checked={onlyPending}
            label="仅看待复核"
            onChange={(checked) => {
              setOnlyPending(checked);
              setFilter({ review: checked ? 'pending' : undefined });
            }}
          />
        </FilterGroup>
      </FilterBar>

      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refresh} title="质检列表加载失败" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={list.loading && !list.data}
            onRowClick={(row) => {
              navigate(`/qc/${row.id}`);
            }}
            empty={
              <EmptyState
                title="没有符合条件的质检会话"
                description="尝试放宽筛选条件，或清空筛选查看全部会话。"
                action={
                  activeFilterCount > 0 ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setQInput('');
                        query.reset();
                      }}
                    >
                      清空筛选
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={list.refresh} leftIcon={<ArrowUpRight size={14} />}>
                      重新加载
                    </Button>
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
              onChange={(next) => {
                query.setParams({ page: next });
              }}
            />
          ) : null}
        </>
      )}
    </>
  );
}
