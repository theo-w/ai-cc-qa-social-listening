import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchAlert, actOnAlert } from '../api/client';
import { useApi } from '../hooks/useApi';
import { alertLevelTone, alertStatusTone, useLabels } from '../lib/labels';
import { formatDateTime } from '../lib/format';
import type { AlertActionRequestType } from '../types';
import { Badge, Button, ErrorState, PageHeader } from '../components/primitives';
import { FilterGroup, TextArea } from '../components/forms';
import { Timeline } from '../components/timeline';

const STATUS_LABELS: Record<string, string> = {
  new: '待确认',
  acknowledged: '已确认',
  responding: '处理中',
  escalated: '已升级',
  resolved: '已解决',
};

export function AlertDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const labels = useLabels();

  const [actionModal, setActionModal] = useState(false);
  const [actionType, setActionType] = useState<AlertActionRequestType>('acknowledge');
  const [actionNote, setActionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const detail = useApi(() => id ? fetchAlert(id) : Promise.resolve(null), [id]);
  const data = detail.data;

  const handleAction = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      await actOnAlert(id, { type: actionType, note: actionNote || undefined });
      detail.refresh();
      setActionModal(false);
    } catch (error: unknown) {
      console.error('Action failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  if (!id) return <ErrorState error="预警 ID 缺失" onRetry={() => navigate('/sentiment?tab=alerts')} title="参数错误" />;

  if (!data) {
    return <ErrorState error={detail.error ?? '加载中'} onRetry={detail.refresh} title="预警详情加载失败" />;
  }

  const alert = data.alert;
  const canAct = alert.status !== 'resolved';
  const actionOptions: Array<{ value: string; label: string }> = [
    { value: 'acknowledge', label: '确认收到' },
    { value: 'respond', label: '开始响应' },
    { value: 'escalate', label: '升级' },
    { value: 'resolve', label: '标记解决' },
    { value: 'comment', label: '添加评论' },
  ].filter((opt) => {
    if (alert.status === 'new') return ['acknowledge', 'comment'].includes(opt.value);
    if (alert.status === 'acknowledged') return ['respond', 'escalate', 'comment'].includes(opt.value);
    if (alert.status === 'responding') return ['escalate', 'resolve', 'comment'].includes(opt.value);
    if (alert.status === 'escalated') return ['resolve', 'comment'].includes(opt.value);
    if (alert.status === 'resolved') return ['comment'].includes(opt.value);
    return false;
  });

  return (
    <>
      <PageHeader
        title="预警详情"
        subtitle={alert.title}
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
            <span className="text-13 muted">级别</span>
            <div><Badge tone={alertLevelTone(alert.level)}>{labels.alertLevel(alert.level)}</Badge></div>
          </div>
          <div>
            <span className="text-13 muted">状态</span>
            <div><Badge tone={alertStatusTone(alert.status)}>{STATUS_LABELS[alert.status]}</Badge></div>
          </div>
          <div>
            <span className="text-13 muted">话题</span>
            <div><Badge tone="info">{alert.topic}</Badge></div>
          </div>
          <div>
            <span className="text-13 muted">责任人</span>
            <div>{alert.owner}</div>
          </div>
          <div>
            <span className="text-13 muted">SLA 截止</span>
            <div className={alert.slaDueAt && Date.parse(alert.slaDueAt) < Date.now() ? 'text-danger' : ''}>{formatDateTime(alert.slaDueAt)}</div>
          </div>
          <div>
            <span className="text-13 muted">SLA 时长</span>
            <div>{alert.slaMinutes} 分钟</div>
          </div>
          <div>
            <span className="text-13 muted">时间窗口</span>
            <div>{formatDateTime(alert.windowStart)} → {formatDateTime(alert.windowEnd)}</div>
          </div>
          <div>
            <span className="text-13 muted">首响时间</span>
            <div>{alert.firstResponseAt ? formatDateTime(alert.firstResponseAt) : '—'}</div>
          </div>
          <div>
            <span className="text-13 muted">解决时间</span>
            <div>{alert.resolvedAt ? formatDateTime(alert.resolvedAt) : '—'}</div>
          </div>
          <div>
            <span className="text-13 muted">关联评论</span>
            <div>{alert.commentIds.length} 条</div>
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <span className="text-13 muted">摘要：</span>{alert.summary}
        </div>
        {alert.triggerRules.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <span className="text-13 muted" style={{ display: 'block', marginBottom: 8 }}>触发规则：</span>
            <div style={{ display: 'grid', gap: 6 }}>
              {alert.triggerRules.map((rule, i) => (
                <div key={i} className="text-13" style={{ padding: 8, background: 'var(--bg-soft)', borderRadius: 6 }}>
                  {rule.ruleId && <span className="mono">{rule.ruleId}</span>}
                  {rule.description && <span className="muted"> — {rule.description}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {data.comments.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>关联评论 ({data.comments.length})</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {data.comments.map((comment) => (
              <div key={comment.id} style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <Badge tone={commentSeverityTone(comment.severity)}>{labels.commentSeverity(comment.severity)}</Badge>
                  <span className={`emotion-text emotion-text--${sentimentTone(comment.sentiment)}`}>{labels.sentiment(comment.sentiment)}</span>
                  <span className="text-12 muted">{comment.author} · {labels.source(comment.source)} · {formatDateTime(comment.publishedAt)}</span>
                </div>
                <div className="text-13">{comment.text}</div>
                {comment.topics.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {comment.topics.map((topic: string) => (
                      <Badge key={topic} tone="info" dot={false}>{topic}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.linkedClues.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>关联线索 ({data.linkedClues.length})</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {data.linkedClues.map((clue) => (
              <div key={clue.id} className="text-13" style={{ padding: 8, background: 'var(--bg-soft)', borderRadius: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Badge tone={clueStatusTone(clue.status)}>{clue.id}</Badge>
                <span>{clue.title}</span>
                <span className="muted">→ {labels.clueTarget(clue.target)}</span>
                <Button variant="text" size="sm" onClick={() => navigate(`/clues/${clue.id}`)}>查看</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>时间线</h3>
        <Timeline entries={alert.timeline.map((a) => ({
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
                onChange={(e) => setActionType(e.target.value as AlertActionRequestType)}
              >
                {actionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FilterGroup>
            <FilterGroup label="备注">
              <TextArea value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="填写操作备注" rows={3} />
            </FilterGroup>
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

function sentimentTone(sentiment: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary' | 'neutral' {
  if (sentiment === 'negative') return 'danger';
  if (sentiment === 'positive') return 'ok';
  return 'muted';
}

function commentSeverityTone(severity: string): 'ok' | 'warn' | 'danger' | 'info' | 'muted' | 'primary' | 'neutral' {
  if (severity === 'p0') return 'danger';
  if (severity === 'p1') return 'warn';
  if (severity === 'p2') return 'info';
  return 'muted';
}

function clueStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'primary' | 'muted' {
  if (status === 'closed') return 'ok';
  if (status === 'accepted') return 'primary';
  if (status === 'rejected') return 'danger';
  if (status === 'routed') return 'info';
  return 'muted';
}
