import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookPlus, FilterX, Sparkles } from 'lucide-react';
import {
  createKnowledge,
  createKnowledgeSuggestion,
  errorMessage,
  fetchKnowledgeGaps,
  fetchKnowledgeList,
  fetchKnowledgeStats,
} from '../api/client';
import { useApi } from '../hooks/useApi';
import { useQueryState, useSearchParamInput } from '../hooks/useQueryState';
import {
  knowledgeSourceTone,
  knowledgeStatusTone,
  useLabels,
  withAll,
} from '../lib/labels';
import { formatDateTime, formatNumber, formatRatio } from '../lib/format';
import type { KnowledgeCategory, KnowledgeListItem, KnowledgeSource, KnowledgeStatus } from '../types';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  StatsStrip,
} from '../components/primitives';
import { FilterBar, FilterGroup, SearchInput, Select, TextArea, TextInput } from '../components/forms';
import { DataTable, Pagination } from '../components/table';
import type { Column } from '../components/table';
import { Modal, useToast } from '../components/overlay';

const PAGE_SIZE = 20;
const STATUS_VALUES: KnowledgeStatus[] = ['draft', 'published', 'offline'];
const CATEGORY_VALUES: KnowledgeCategory[] = ['refund', 'recharge', 'activity', 'version', 'account', 'other'];
const SOURCE_VALUES: KnowledgeSource[] = ['official', 'qc_badcase', 'manual'];

function pick<T extends string>(raw: string, allowed: readonly T[]): T | undefined {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

export function KnowledgeListPage() {
  const navigate = useNavigate();
  const labels = useLabels();
  const toast = useToast();
  const query = useQueryState();
  const [qInput, setQInput] = useSearchParamInput('q');

  const status = pick(query.get('status'), STATUS_VALUES);
  const category = pick(query.get('category'), CATEGORY_VALUES);
  const source = pick(query.get('source'), SOURCE_VALUES);
  const page = query.getNumber('page', 1);

  const stats = useApi(() => fetchKnowledgeStats(), []);
  const gaps = useApi(() => fetchKnowledgeGaps(), []);
  const list = useApi(
    () => fetchKnowledgeList({ q: qInput, status, category, source, page, pageSize: PAGE_SIZE }),
    [qInput, status, category, source, page],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingGapId, setCreatingGapId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [createCategory, setCreateCategory] = useState<KnowledgeCategory>('refund');
  const [content, setContent] = useState('');
  const [keywords, setKeywords] = useState('');

  const setFilter = (patch: Record<string, string | number | undefined>) => {
    query.setParams({ ...patch, page: undefined });
  };

  const activeFilterCount = [status, category, source].filter(Boolean).length;

  const handleCreate = async () => {
    if (title.trim() === '' || content.trim() === '') {
      toast.error('信息不完整', '标题与标准口径不能为空。');
      return;
    }
    setCreating(true);
    try {
      const entry = await createKnowledge({
        title: title.trim(),
        category: createCategory,
        content: content.trim(),
        keywords: keywords
          .split(/[,，\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        source: 'manual',
      });
      setCreateOpen(false);
      setTitle('');
      setContent('');
      setKeywords('');
      toast.success('知识草稿已创建', `${entry.code} · ${entry.title}，请补齐可校验事实后发布。`);
      navigate(`/knowledge/${entry.id}`);
    } catch (error) {
      toast.error('创建失败', errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const handleGapDraft = async (gapId: string, conversationId: string) => {
    setCreatingGapId(gapId);
    try {
      const entry = await createKnowledgeSuggestion({ conversationId });
      toast.success('知识完善草稿已就绪', `${entry.code} · ${entry.title}`);
      navigate(`/knowledge/${entry.id}`);
    } catch (error) {
      toast.error('生成草稿失败', errorMessage(error));
    } finally {
      setCreatingGapId(null);
    }
  };

  const statItems = stats.data
    ? [
        {
          label: '已发布',
          value: formatNumber(stats.data.published, 0),
          aside: `/ ${formatNumber(stats.data.total, 0)} 条`,
          key: 'published',
        },
        { label: '草稿', value: formatNumber(stats.data.draft, 0), aside: '待完善', key: 'draft' },
        {
          label: '知识错误关联率',
          value: formatRatio(stats.data.hits.linkRate),
          aside: `${formatNumber(stats.data.hits.linked, 0)} / ${formatNumber(stats.data.hits.knowledgeTags, 0)} 条命中`,
          key: 'linkRate',
        },
        {
          label: '待完善缺口',
          value: formatNumber(stats.data.gaps, 0),
          aside: stats.data.gaps > 0 ? '需知识运营处理' : '全部已覆盖',
          key: 'gaps',
        },
      ]
    : [
        { label: '已发布', value: '—', key: 'published' },
        { label: '草稿', value: '—', key: 'draft' },
        { label: '知识错误关联率', value: '—', key: 'linkRate' },
        { label: '待完善缺口', value: '—', key: 'gaps' },
      ];

  const columns: Array<Column<KnowledgeListItem>> = useMemo(
    () => [
      {
        key: 'code',
        header: '编号',
        width: '110px',
        render: (row) => <span className="mono">{row.code}</span>,
      },
      {
        key: 'title',
        header: '条目',
        render: (row) => (
          <div className="cell-primary">
            <span>{row.title}</span>
            <span className="cell-primary__sub">{labels.knowledgeCategory(row.category)}</span>
          </div>
        ),
      },
      {
        key: 'version',
        header: '版本',
        numeric: true,
        width: '70px',
        render: (row) => <span className="tnum">v{row.version}</span>,
      },
      {
        key: 'status',
        header: '状态',
        render: (row) => (
          <Badge tone={knowledgeStatusTone(row.status)}>{labels.knowledgeStatus(row.status)}</Badge>
        ),
      },
      {
        key: 'source',
        header: '来源',
        render: (row) => (
          <Badge tone={knowledgeSourceTone(row.source)} dot={false}>
            {labels.knowledgeSource(row.source)}
          </Badge>
        ),
      },
      {
        key: 'hits',
        header: '知识错误命中',
        numeric: true,
        render: (row) => (
          <span className="tnum">
            {row.linkedHits}
            {row.knowledgeHits !== row.linkedHits ? ` / ${row.knowledgeHits}` : ''}
          </span>
        ),
      },
      {
        key: 'badcases',
        header: '关联 badcase',
        numeric: true,
        render: (row) => <span className="tnum">{row.linkedBadcases}</span>,
      },
      {
        key: 'updatedAt',
        header: '更新时间',
        render: (row) => <span className="tnum">{formatDateTime(row.updatedAt)}</span>,
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
              navigate(`/knowledge/${row.id}`);
            }}
          >
            查看
          </Button>
        ),
      },
    ],
    [labels, navigate],
  );

  const gapItems = gaps.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="知识库"
        subtitle="质检口径、知识缺口与完善闭环：发布后自动复测未复核会话。"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
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
            <Button
              variant="primary"
              size="sm"
              leftIcon={<BookPlus size={14} />}
              onClick={() => setCreateOpen(true)}
            >
              新建条目
            </Button>
          </div>
        }
      />

      {stats.error ? (
        <p className="text-13" style={{ marginBottom: 'var(--sp-3)', color: 'var(--danger)' }}>
          统计加载失败：{stats.error}
        </p>
      ) : (
        <StatsStrip items={statItems} />
      )}

      {gapItems.length > 0 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>知识缺口</h3>
            <span className="text-12 muted">质检命中或知识类 badcase 尚未被条目覆盖，建议优先处理</span>
          </div>
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            {gapItems.map((gap) => (
              <div
                key={gap.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 12,
                  padding: 12,
                  background: 'var(--bg-soft)',
                  borderRadius: 8,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Badge tone="warn" dot={false}>
                      {gap.type === 'unlinked_qc_hit' ? `规则 ${gap.ruleId ?? '—'}` : 'badcase'}
                    </Badge>
                    <span style={{ fontWeight: 600 }}>{gap.title}</span>
                    <span className="text-12 muted">出现 {gap.count} 次 · 建议分类「{labels.knowledgeCategory(gap.category)}」</span>
                  </div>
                  <div className="text-12 muted" style={{ marginTop: 6 }}>
                    {gap.sample.conversationId}
                    {gap.sample.quote ? ` · 「${gap.sample.quote}」` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => navigate(`/qc/${gap.sample.conversationId}`)}
                  >
                    查看会话
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Sparkles size={14} />}
                    loading={creatingGapId === gap.id}
                    onClick={() => void handleGapDraft(gap.id, gap.sample.conversationId)}
                  >
                    生成草稿
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <FilterBar>
        <FilterGroup>
          <SearchInput
            value={qInput}
            onChange={setQInput}
            placeholder="搜索编号 / 标题 / 关键词"
            ariaLabel="搜索知识条目"
          />
        </FilterGroup>
        <FilterGroup label="状态">
          <Select
            value={status ?? ''}
            ariaLabel="按状态筛选"
            options={withAll(
              STATUS_VALUES.map((value) => ({ value, label: labels.knowledgeStatus(value) })),
              '全部状态',
            )}
            onChange={(value) => setFilter({ status: value || undefined })}
          />
        </FilterGroup>
        <FilterGroup label="分类">
          <Select
            value={category ?? ''}
            ariaLabel="按分类筛选"
            options={withAll(
              CATEGORY_VALUES.map((value) => ({ value, label: labels.knowledgeCategory(value) })),
              '全部分类',
            )}
            onChange={(value) => setFilter({ category: value || undefined })}
          />
        </FilterGroup>
        <FilterGroup label="来源">
          <Select
            value={source ?? ''}
            ariaLabel="按来源筛选"
            options={withAll(
              SOURCE_VALUES.map((value) => ({ value, label: labels.knowledgeSource(value) })),
              '全部来源',
            )}
            onChange={(value) => setFilter({ source: value || undefined })}
          />
        </FilterGroup>
      </FilterBar>

      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refresh} title="知识库加载失败" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={list.loading && !list.data}
            onRowClick={(row) => navigate(`/knowledge/${row.id}`)}
            empty={
              <EmptyState
                title="没有符合条件的知识条目"
                description="尝试放宽筛选条件，或新建一条知识草稿。"
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
                    <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                      新建条目
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
              onChange={(next) => query.setParams({ page: next })}
            />
          ) : null}
        </>
      )}

      <Modal
        open={createOpen}
        title="新建知识条目"
        description="先创建草稿；在详情页补齐结构化事实后才能发布并参与质检。"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              取消
            </Button>
            <Button variant="primary" loading={creating} onClick={() => void handleCreate()}>
              创建草稿
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <label className="field">
            <span className="field__label">标题</span>
            <TextInput
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="如：退款规则与手续费"
              maxLength={200}
            />
          </label>
          <label className="field">
            <span className="field__label">分类</span>
            <Select
              value={createCategory}
              ariaLabel="知识分类"
              options={CATEGORY_VALUES.map((value) => ({ value, label: labels.knowledgeCategory(value) }))}
              onChange={(value) => setCreateCategory(value as KnowledgeCategory)}
            />
          </label>
          <label className="field">
            <span className="field__label">标准口径</span>
            <TextArea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={4}
              placeholder="写清官方标准答案；发布前需补充可校验事实"
            />
          </label>
          <label className="field">
            <span className="field__label">关键词（逗号分隔）</span>
            <TextInput
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="退款, 手续费, 原路退回"
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
