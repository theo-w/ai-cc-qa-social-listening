import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FilterX } from 'lucide-react';
import { fetchComments, fetchSentimentStats } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useSearchParamInput, useQueryState } from '../hooks/useQueryState';
import {
  SENTIMENT_LABELS,
  SOURCE_LABELS,
  COMMENT_SEVERITY_LABELS,
  dictOptions,
  sentimentTone,
  commentSeverityTone,
  useLabels,
  withAll,
} from '../lib/labels';
import { formatDateTime, formatNumber, formatRatio } from '../lib/format';
import type { CommentSeverity, Range, SentimentSource, SentimentValue } from '../types';
import { Badge, Button, EmptyState, ErrorState, PageHeader, StatsStrip } from '../components/primitives';
import { FilterBar, FilterGroup, SearchInput, Select } from '../components/forms';
import { DataTable, Pagination } from '../components/table';
import type { Column } from '../components/table';

const PAGE_SIZE = 20;

const SOURCE_VALUES: SentimentSource[] = ['steam', 'taptap', 'googleplay', 'community', 'ticket'];
const SENTIMENT_VALUES: SentimentValue[] = ['positive', 'neutral', 'negative'];
const SEVERITY_VALUES: CommentSeverity[] = ['p0', 'p1', 'p2', 'none'];

function pick<T extends string>(raw: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function CommentListPage() {
  const navigate = useNavigate();
  const labels = useLabels();
  const query = useQueryState();
  const [qInput, setQInput] = useSearchParamInput('q');

  const rangeParam = query.get('range');
  const range: Range = rangeParam === '14d' || rangeParam === '30d' ? rangeParam : '7d';
  const source = pick(query.get('source'), SOURCE_VALUES);
  const sentiment = pick(query.get('sentiment'), SENTIMENT_VALUES);
  const severity = pick(query.get('severity'), SEVERITY_VALUES);
  const page = query.getNumber('page', 1);

  const stats = useApi(() => fetchSentimentStats(range), [range]);
  const list = useApi(
    () =>
      fetchComments({
        q: qInput,
        page,
        pageSize: PAGE_SIZE,
        source,
        sentiment,
        severity,
      }),
    [qInput, page, source, sentiment, severity],
  );

  const setFilter = (patch: Record<string, string | number | undefined>) => {
    query.setParams({ ...patch, page: undefined });
  };

  const activeFilterCount = [source, sentiment, severity].filter(Boolean).length;

  const columns: Array<Column<any>> = [
    {
      key: 'author',
      header: '作者',
      render: (row) => (
        <div className="cell-primary">
          <span>{row.author}</span>
          <span className="cell-primary__sub">{row.text.slice(0, 60)}…</span>
        </div>
      ),
    },
    { key: 'source', header: '来源', render: (row) => labels.source(row.source) },
    { key: 'brand', header: '品牌', render: (row) => <span className="muted">{row.brand}</span> },
    {
      key: 'sentiment',
      header: '情感',
      render: (row) => (
        <span className={`emotion-text emotion-text--${sentimentTone(row.sentiment)}`}>{labels.sentiment(row.sentiment)}</span>
      ),
    },
    {
      key: 'severity',
      header: '严重度',
      render: (row) => (
        row.severity !== 'none' ? (
          <Badge tone={commentSeverityTone(row.severity)}>{labels.commentSeverity(row.severity)}</Badge>
        ) : (
          <span className="muted">—</span>
        )
      ),
    },
    {
      key: 'topics',
      header: '话题',
      render: (row) => (
        <div className="chips">
          {row.topics.slice(0, 2).map((topic: string) => (
            <Badge key={topic} tone="info" dot={false}>
              {topic}
            </Badge>
          ))}
          {row.topics.length > 2 ? <span className="text-12 muted">+{row.topics.length - 2}</span> : null}
        </div>
      ),
    },
    { key: 'publishedAt', header: '发布时间', render: (row) => <span className="tnum">{formatDateTime(row.publishedAt)}</span> },
    {
      key: 'actions',
      header: '操作',
      center: true,
      render: (row) => (
        <Button variant="text" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/sentiment/alerts/${row.alertId}`); }}>
          预警
        </Button>
      ),
    },
  ];

  const statItems = stats.data
    ? [
        { label: '评论总量', value: formatNumber(stats.data.comments, 0), key: 'comments' },
        { label: '已分析', value: formatNumber(stats.data.analyzed, 0), key: 'analyzed' },
        {
          label: '负面占比',
          value: formatRatio(stats.data.negativeRatio),
          aside: `${formatNumber(stats.data.comments * stats.data.negativeRatio, 0)} 条`,
          key: 'negative',
        },
        { label: '待复核', value: formatNumber(stats.data.needsReview, 0), key: 'needsReview' },
        { label: '预警总数', value: formatNumber(stats.data.alertsTotal, 0), key: 'alertsTotal' },
        { label: '待处理预警', value: formatNumber(stats.data.alertsOpen, 0), key: 'alertsOpen' },
        { label: 'P0', value: formatNumber(stats.data.p0, 0), key: 'p0' },
        { label: 'P1', value: formatNumber(stats.data.p1, 0), key: 'p1' },
        { label: 'P2', value: formatNumber(stats.data.p2, 0), key: 'p2' },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="舆情评论"
        subtitle="监控各渠道用户评论的情感倾向与风险等级。"
        actions={
          <Button variant="secondary" size="sm" leftIcon={<FilterX size={14} />} onClick={() => { setQInput(''); query.reset(); }}>
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
        <FilterGroup>
          <SearchInput
            value={qInput}
            onChange={setQInput}
            placeholder="搜索评论 / 作者"
            ariaLabel="搜索评论或作者"
          />
        </FilterGroup>
        <FilterGroup label="来源">
          <Select
            value={source ?? ''}
            options={withAll(dictOptions(SOURCE_LABELS), '全部来源')}
            onChange={(value) => setFilter({ source: value || undefined })}
          />
        </FilterGroup>
        <FilterGroup label="情感">
          <Select
            value={sentiment ?? ''}
            options={withAll(dictOptions(SENTIMENT_LABELS), '全部情感')}
            onChange={(value) => setFilter({ sentiment: value || undefined })}
          />
        </FilterGroup>
        <FilterGroup label="严重度">
          <Select
            value={severity ?? ''}
            options={withAll(dictOptions(COMMENT_SEVERITY_LABELS), '全部')}
            onChange={(value) => setFilter({ severity: value || undefined })}
          />
        </FilterGroup>
      </FilterBar>

      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refresh} title="评论列表加载失败" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={list.loading && !list.data}
            onRowClick={(row) => navigate(`/sentiment/alerts/${row.alertId}`)}
            empty={
              <EmptyState
                title="没有符合条件的评论"
                description="尝试放宽筛选条件。"
                action={
                  activeFilterCount > 0 ? (
                    <Button variant="secondary" size="sm" onClick={() => { setQInput(''); query.reset(); }}>清空筛选</Button>
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
