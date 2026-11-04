import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FilterX, Plus } from 'lucide-react';
import { fetchClues, createClue, actOnClue } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useQueryState } from '../hooks/useQueryState';
import { useAppData } from '../hooks/useAppData';
import {
  CLUE_SOURCE_LABELS,
  CLUE_TARGET_LABELS,
  CLUE_STATUS_LABELS,
  PRIORITY_LABELS,
  dictOptions,
  clueStatusTone,
  clueTargetTone,
  priorityTone,
  useLabels,
  withAll,
  ownerOptions,
} from '../lib/labels';
import { formatDateTime } from '../lib/format';
import type { ClueStatus, ClueTarget, ClueSourceType, CluePriority, ClueActionRequestType } from '../types';
import { Badge, Button, EmptyState, ErrorState, PageHeader } from '../components/primitives';
import { FilterBar, FilterGroup, Select, TextArea } from '../components/forms';
import { DataTable, Pagination } from '../components/table';
import type { Column } from '../components/table';

const PAGE_SIZE = 20;

const STATUS_VALUES: ClueStatus[] = ['draft', 'routed', 'accepted', 'rejected', 'closed'];
const TARGET_VALUES: ClueTarget[] = ['product', 'brand', 'market', 'cs'];
const SOURCE_TYPE_VALUES: ClueSourceType[] = ['qc', 'sentiment', 'dashboard', 'agent'];

export function ClueListPage() {
  const navigate = useNavigate();
  const labels = useLabels();
  const { meta } = useAppData();
  const query = useQueryState();

  const status = query.get('status') as ClueStatus | undefined;
  const target = query.get('target') as ClueTarget | undefined;
  const sourceType = query.get('sourceType') as ClueSourceType | undefined;
  const page = query.getNumber('page', 1);

  const list = useApi(
    () => fetchClues({ page, pageSize: PAGE_SIZE, status, target, sourceType }),
    [page, status, target, sourceType],
  );

  const [createModal, setCreateModal] = useState(false);
  const [actionModal, setActionModal] = useState<string | null>(null);
  const [actionType, setActionType] = useState<ClueActionRequestType>('accept');
  const [actionNote, setActionNote] = useState('');
  const [actionOwner, setActionOwner] = useState('');
  const [actionOutcome, setActionOutcome] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createTarget, setCreateTarget] = useState<ClueTarget>('product');
  const [createPriority, setCreatePriority] = useState<CluePriority>('medium');
  const [createSourceType, setCreateSourceType] = useState<ClueSourceType>('agent');

  const setFilter = (patch: Record<string, string | number | undefined>) => {
    query.setParams({ ...patch, page: undefined });
  };

  const activeFilterCount = [status, target, sourceType].filter(Boolean).length;

  const handleCreate = async () => {
    if (!createTitle.trim()) return;
    try {
      await createClue({
        title: createTitle.trim(),
        description: createDesc.trim(),
        sourceType: createSourceType,
        sourceRef: { type: createSourceType, label: labels.clueSourceType(createSourceType) },
        target: createTarget,
        priority: createPriority,
        createdBy: '陆川',
      });
      list.refresh();
      setCreateModal(false);
      setCreateTitle('');
      setCreateDesc('');
    } catch (error: unknown) {
      console.error('Create clue failed:', error);
    }
  };

  const handleAction = async (clueId: string) => {
    setSubmitting(true);
    try {
      const body: any = { type: actionType };
      if (actionType === 'route' && actionOwner) body.owner = actionOwner;
      if ((actionType === 'accept' || actionType === 'reject' || actionType === 'comment') && actionNote) body.note = actionNote;
      if (actionType === 'close' && actionOutcome) body.outcome = actionOutcome;
      await actOnClue(clueId, body);
      list.refresh();
      setActionModal(null);
    } catch (error: unknown) {
      console.error('Action failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const getActionOptions = (clue: any): { value: ClueActionRequestType; label: string }[] => {
    if (clue.status === 'draft') return [{ value: 'route', label: '提交分派' }];
    if (clue.status === 'routed') return [{ value: 'accept', label: '接受线索' }, { value: 'reject', label: '拒绝线索' }];
    if (clue.status === 'accepted') return [{ value: 'close', label: '关闭线索' }, { value: 'comment', label: '添加评论' }];
    if (clue.status === 'rejected') return [{ value: 'comment', label: '添加评论' }];
    if (clue.status === 'closed') return [{ value: 'comment', label: '添加评论' }];
    return [];
  };

  const columns: Array<Column<any>> = [
    {
      key: 'title',
      header: '标题',
      render: (row) => (
        <div className="cell-primary">
          <span className="mono">{row.id}</span>
          <span className="cell-primary__sub">{row.title}</span>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (row) => <Badge tone={clueStatusTone(row.status)}>{labels.clueStatus(row.status)}</Badge>,
    },
    {
      key: 'target',
      header: '目标',
      render: (row) => <Badge tone={clueTargetTone(row.target)}>{labels.clueTarget(row.target)}</Badge>,
    },
    {
      key: 'priority',
      header: '优先级',
      render: (row) => <Badge tone={priorityTone(row.priority)}>{labels.priority(row.priority)}</Badge>,
    },
    {
      key: 'sourceType',
      header: '来源',
      render: (row) => <span className="muted">{labels.clueSourceType(row.sourceType)}</span>,
    },
    { key: 'owner', header: '责任人', render: (row) => <span>{row.owner}</span> },
    { key: 'createdAt', header: '创建时间', render: (row) => <span className="tnum">{formatDateTime(row.createdAt)}</span> },
    {
      key: 'actions',
      header: '操作',
      center: true,
      render: (row) => (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <Button variant="text" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/clues/${row.id}`); }}>详情</Button>
          {getActionOptions(row).length > 0 && (
            <Button variant="text" size="sm" onClick={(e) => { e.stopPropagation(); setActionModal(row.id); const opts = getActionOptions(row); setActionType(opts[0]!.value); setActionNote(''); setActionOwner(''); setActionOutcome(''); }}>操作</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="线索管理"
        subtitle="将质检、舆情中发现的问题转化为可追踪的改进线索。"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" size="sm" leftIcon={<FilterX size={14} />} onClick={() => query.reset()}>
              清空筛选
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Plus size={14} />} onClick={() => setCreateModal(true)}>
              新建线索
            </Button>
          </div>
        }
      />

      <FilterBar>
        <FilterGroup label="状态">
          <Select
            value={status ?? ''}
            options={withAll(STATUS_VALUES.map((s) => ({ value: s, label: CLUE_STATUS_LABELS[s] || '' })), '全部状态')}
            onChange={(value) => setFilter({ status: value || undefined })}
          />
        </FilterGroup>
        <FilterGroup label="目标">
          <Select
            value={target ?? ''}
            options={withAll(TARGET_VALUES.map((t) => ({ value: t, label: CLUE_TARGET_LABELS[t] || '' })), '全部目标')}
            onChange={(value) => setFilter({ target: value || undefined })}
          />
        </FilterGroup>
        <FilterGroup label="来源">
          <Select
            value={sourceType ?? ''}
            options={withAll(SOURCE_TYPE_VALUES.map((s) => ({ value: s, label: CLUE_SOURCE_LABELS[s] || '' })), '全部来源')}
            onChange={(value) => setFilter({ sourceType: value || undefined })}
          />
        </FilterGroup>
      </FilterBar>

      {list.error ? (
        <ErrorState error={list.error} onRetry={list.refresh} title="线索列表加载失败" />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={list.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={list.loading && !list.data}
            onRowClick={(row) => navigate(`/clues/${row.id}`)}
            empty={
              <EmptyState
                title="没有符合条件的线索"
                description="尝试放宽筛选条件。"
                action={
                  activeFilterCount > 0 ? (
                    <Button variant="secondary" size="sm" onClick={() => query.reset()}>清空筛选</Button>
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

      {createModal && (
        <div className="modal-overlay" onClick={() => setCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>新建线索</h3>
            <FilterGroup label="标题">
              <input className="input" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} placeholder="线索标题" />
            </FilterGroup>
            <FilterGroup label="描述">
              <TextArea value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="详细描述问题" rows={3} />
            </FilterGroup>
            <FilterGroup label="目标部门">
              <Select
                value={createTarget}
                options={dictOptions(CLUE_TARGET_LABELS)}
                onChange={(value) => setCreateTarget(value as ClueTarget)}
              />
            </FilterGroup>
            <FilterGroup label="优先级">
              <Select
                value={createPriority}
                options={dictOptions(PRIORITY_LABELS)}
                onChange={(value) => setCreatePriority(value as CluePriority)}
              />
            </FilterGroup>
            <FilterGroup label="来源类型">
              <Select
                value={createSourceType}
                options={dictOptions(CLUE_SOURCE_LABELS)}
                onChange={(value) => setCreateSourceType(value as ClueSourceType)}
              />
            </FilterGroup>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setCreateModal(false)}>取消</Button>
              <Button variant="primary" disabled={!createTitle.trim()} onClick={handleCreate}>创建</Button>
            </div>
          </div>
        </div>
      )}

      {actionModal && (
        <div className="modal-overlay" onClick={() => setActionModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>操作线索</h3>
            <FilterGroup label="操作类型">
              <select
                className="input"
                value={actionType}
                onChange={(e) => setActionType(e.target.value as ClueActionRequestType)}
              >
                {getActionOptions(list.data?.items.find((r: any) => r.id === actionModal) || {}).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FilterGroup>
            {actionType === 'route' && (
              <FilterGroup label="责任人">
                <Select
                  value={actionOwner}
                  options={ownerOptions(meta)}
                  onChange={setActionOwner}
                />
              </FilterGroup>
            )}
            {['accept', 'reject', 'comment'].includes(actionType) && (
              <FilterGroup label="备注">
                <TextArea value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="填写备注" rows={3} />
              </FilterGroup>
            )}
            {actionType === 'close' && (
              <FilterGroup label="关闭说明">
                <TextArea value={actionOutcome} onChange={(e) => setActionOutcome(e.target.value)} placeholder="填写关闭说明" rows={3} />
              </FilterGroup>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setActionModal(null)}>取消</Button>
              <Button variant="primary" loading={submitting} onClick={() => handleAction(actionModal!)}>确认</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
