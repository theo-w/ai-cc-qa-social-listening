import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Sparkles } from 'lucide-react';
import {
  actOnBadcase,
  createKnowledgeSuggestion,
  errorMessage,
  fetchBadcase,
  fetchKnowledgeList,
} from '../api/client';
import { useApi } from '../hooks/useApi';
import { knowledgeStatusTone, severityTone, useLabels } from '../lib/labels';
import { formatDateTime } from '../lib/format';
import type { BadcaseActionRequestType } from '../types';
import { Badge, Button, ErrorState, PageHeader } from '../components/primitives';
import { FilterGroup, TextArea } from '../components/forms';
import { Timeline } from '../components/timeline';
import { useToast } from '../components/overlay';

const STATUS_LABELS: Record<string, string> = {
  open: '待处理',
  in_progress: '处理中',
  pending_verify: '待验证',
  closed: '已闭环',
};

export function BadcaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const labels = useLabels();
  const toast = useToast();

  const [actionModal, setActionModal] = useState(false);
  const [actionType, setActionType] = useState<BadcaseActionRequestType>('progress');
  const [actionNote, setActionNote] = useState('');
  const [actionProof, setActionProof] = useState('');
  const [actionOwner, setActionOwner] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [knowledgeSubmitting, setKnowledgeSubmitting] = useState(false);

  const detail = useApi(() => id ? fetchBadcase(id) : Promise.resolve(null), [id]);
  const data = detail.data;
  const knowledge = useApi(
    () => (id ? fetchKnowledgeList({ badcaseId: id, pageSize: 100 }) : Promise.resolve(null)),
    [id],
  );

  const handleAction = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      const body: any = { type: actionType };
      if (actionType === 'assign' && actionOwner) body.owner = actionOwner;
      if ((actionType === 'progress' || actionType === 'verify' || actionType === 'reopen' || actionType === 'comment') && actionNote) body.note = actionNote;
      if (actionType === 'close' && actionProof) body.proof = actionProof;
      await actOnBadcase(id, body);
      detail.refresh();
      setActionModal(false);
    } catch (error: unknown) {
      console.error('Action failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKnowledgeDraft = async () => {
    if (!id) return;
    setKnowledgeSubmitting(true);
    try {
      const entry = await createKnowledgeSuggestion({ badcaseId: id });
      toast.success('知识完善草稿已就绪', `${entry.code} · ${entry.title}`);
      navigate(`/knowledge/${entry.id}`);
    } catch (error) {
      toast.error('生成知识草稿失败', errorMessage(error));
    } finally {
      setKnowledgeSubmitting(false);
    }
  };

  if (!id) return <ErrorState error="badcase ID 缺失" onRetry={() => navigate('/badcases')} title="参数错误" />;

  if (!data) {
    return (
      <ErrorState error={detail.error ?? '加载中'} onRetry={detail.refresh} title="badcase 详情加载失败" />
    );
  }

  const canAct = data.status !== 'closed';
  const actionOptions: Array<{ value: string; label: string }> = [
    { value: 'assign', label: '分派' },
    { value: 'progress', label: '推进' },
    { value: 'verify', label: '验证' },
    { value: 'close', label: '关闭' },
    { value: 'reopen', label: '重新打开' },
    { value: 'comment', label: '评论' },
  ].filter((opt) => {
    if (data.status === 'open' || data.status === 'in_progress') {
      return ['assign', 'progress', 'comment'].includes(opt.value);
    }
    if (data.status === 'pending_verify') return ['close', 'comment'].includes(opt.value);
    if (data.status === 'closed') return ['reopen', 'comment'].includes(opt.value);
    return false;
  });

  return (
    <>
      <PageHeader
        title="badcase 详情"
        subtitle={data.code}
        actions={
          canAct ? (
            <Button variant="primary" size="sm" onClick={() => setActionModal(true)}>执行操作</Button>
          ) : null
        }
      />

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>基本信息</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <span className="text-13 muted">标题</span>
            <div>{data.title}</div>
          </div>
          <div>
            <span className="text-13 muted">归因类别</span>
            <div><Badge tone="info">{labels.badcaseCategory(data.category)}</Badge></div>
          </div>
          <div>
            <span className="text-13 muted">状态</span>
            <div><Badge tone={data.status === 'closed' ? 'ok' : data.status === 'in_progress' ? 'info' : 'warn'}>{STATUS_LABELS[data.status]}</Badge></div>
          </div>
          <div>
            <span className="text-13 muted">严重级别</span>
            <div><Badge tone={severityTone(data.severity)}>{data.severity}</Badge></div>
          </div>
          <div>
            <span className="text-13 muted">责任人</span>
            <div>{data.owner}</div>
          </div>
          <div>
            <span className="text-13 muted">创建人</span>
            <div>{data.creator}</div>
          </div>
          <div>
            <span className="text-13 muted">SLA 截止</span>
            <div>{formatDateTime(data.dueAt)}</div>
          </div>
          <div>
            <span className="text-13 muted">SLA 时长</span>
            <div>{data.slaHours} 小时</div>
          </div>
          <div>
            <span className="text-13 muted">复发</span>
            <div>{data.recurrence ? <Badge tone="danger">是（复发于 {data.recurrenceOf}）</Badge> : <span className="muted">否</span>}</div>
          </div>
          <div>
            <span className="text-13 muted">关联会话</span>
            <div><Button variant="text" size="sm" onClick={() => navigate(`/qc/${data.conversationId}`)}>{data.conversationId}</Button></div>
          </div>
        </div>
        {data.rootCause && (
          <div style={{ marginTop: 16 }}>
            <span className="text-13 muted">根因描述：</span>{data.rootCause}
          </div>
        )}
        {data.proof && (
          <div style={{ marginTop: 16 }}>
            <span className="text-13 muted">整改证明：</span>{data.proof}
          </div>
        )}
      </div>

      {data.category === 'knowledge' && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>知识完善</h3>
            <span className="text-12 muted">知识类 badcase 应关联或沉淀知识条目</span>
          </div>
          {(knowledge.data?.items ?? []).length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {(knowledge.data?.items ?? []).map((entry) => (
                <div
                  key={entry.id}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10, background: 'var(--bg-soft)', borderRadius: 8 }}
                >
                  <BookOpen size={14} aria-hidden="true" />
                  <Button variant="text" size="sm" onClick={() => navigate(`/knowledge/${entry.id}`)}>
                    {entry.code}
                  </Button>
                  <span>{entry.title}</span>
                  <Badge tone={knowledgeStatusTone(entry.status)} dot={false}>
                    {labels.knowledgeStatus(entry.status)}
                  </Badge>
                  <Badge tone="info" dot={false}>
                    v{entry.version}
                  </Badge>
                  <span className="text-12 muted">知识错误命中 {entry.linkedHits} 条</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="text-13 muted">该 badcase 尚未关联知识条目。</span>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Sparkles size={14} />}
                loading={knowledgeSubmitting}
                onClick={() => void handleKnowledgeDraft()}
              >
                生成知识完善草稿
              </Button>
            </div>
          )}
        </div>
      )}

      {data.evidence.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>证据</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {data.evidence.map((ev, i) => (
              <div key={i} className="text-13" style={{ padding: 8, background: 'var(--bg-soft)', borderRadius: 6 }}>
                <span className="muted">[{ev.seq}]</span> {ev.quote}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>时间线</h3>
        <Timeline entries={data.timeline.map((a) => ({
          key: a.type,
          at: a.at,
          label: a.type,
          by: a.by,
          note: a.note ?? undefined,
        }))} />
      </div>

      {/* 操作弹窗 */}
      {actionModal && (
        <div className="modal-overlay" onClick={() => setActionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>执行操作</h3>
            <FilterGroup label="操作类型">
              <select
                className="input"
                value={actionType}
                onChange={(e) => setActionType(e.target.value as BadcaseActionRequestType)}
              >
                {actionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FilterGroup>
            {actionType === 'assign' && (
              <FilterGroup label="责任人">
                <input className="input" value={actionOwner} onChange={(e) => setActionOwner(e.target.value)} placeholder="输入责任人姓名" />
              </FilterGroup>
            )}
            {['progress', 'verify', 'reopen', 'comment'].includes(actionType) && (
              <FilterGroup label="备注">
                <TextArea value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="填写操作备注" rows={3} />
              </FilterGroup>
            )}
            {actionType === 'close' && (
              <FilterGroup label="整改证明">
                <TextArea value={actionProof} onChange={(e) => setActionProof(e.target.value)} placeholder="填写整改证明" rows={3} />
              </FilterGroup>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setActionModal(false)}>取消</Button>
              <Button variant="primary" loading={submitting} onClick={handleAction}>确认</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
