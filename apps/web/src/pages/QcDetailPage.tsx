import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, BookOpen, Pencil } from 'lucide-react';
import {
  createBadcase,
  createKnowledgeSuggestion,
  errorMessage,
  fetchConversation,
  submitReview,
} from '../api/client';
import { useApi } from '../hooks/useApi';
import {
  emotionTone,
  severityTone,
  useLabels,
  ROLE_LABELS,
} from '../lib/labels';
import { formatDateTime, formatNumber } from '../lib/format';
import type { QcTag, ReviewDecision } from '../types';
import { Badge, Button, ErrorState, PageHeader, ScoreLine } from '../components/primitives';
import { FilterGroup, TextArea } from '../components/forms';
import { Timeline } from '../components/timeline';
import { useToast } from '../components/overlay';

export function QcDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const labels = useLabels();
  const toast = useToast();

  const [reviewModal, setReviewModal] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision>('confirm');
  const [reviewNote, setReviewNote] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [knowledgeSubmitting, setKnowledgeSubmitting] = useState(false);

  const [badcaseModal, setBadcaseModal] = useState(false);
  const [bcCategory, setBcCategory] = useState('knowledge');
  const [bcTitle, setBcTitle] = useState('');
  const [bcRootCause, setBcRootCause] = useState('');
  const [bcSubmitting, setBcSubmitting] = useState(false);

  const detail = useApi(() => id ? fetchConversation(id) : Promise.resolve(null), [id]);

  const data = detail.data;
  const conversation = data?.conversation;
  const qcResult = data?.qcResult;
  const review = data?.review;
  const badcase = data?.badcase;

  const handleReview = async () => {
    setReviewSubmitting(true);
    try {
      await submitReview(id!, { decision: reviewDecision, finalTags: [], note: reviewNote || undefined });
      detail.refresh();
      setReviewModal(false);
    } catch (error: unknown) {
      console.error('Review failed:', error);
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleCreateKnowledge = async () => {
    if (!id) return;
    setKnowledgeSubmitting(true);
    try {
      const entry = await createKnowledgeSuggestion({ conversationId: id });
      toast.success('知识完善草稿已就绪', `${entry.code} · ${entry.title}`);
      navigate(`/knowledge/${entry.id}`);
    } catch (error) {
      toast.error('生成知识草稿失败', errorMessage(error));
    } finally {
      setKnowledgeSubmitting(false);
    }
  };

  const handleCreateBadcase = async () => {
    setBcSubmitting(true);
    try {
      await createBadcase(id!, { category: bcCategory as any, title: bcTitle || undefined, rootCause: bcRootCause || undefined });
      detail.refresh();
      setBadcaseModal(false);
    } catch (error: unknown) {
      console.error('Badcase creation failed:', error);
    } finally {
      setBcSubmitting(false);
    }
  };

  const messages = conversation?.messages ?? [];
  const reviewable = !review && qcResult?.needsReview;

  return (
    <>
      <PageHeader
        title="质检详情"
        subtitle={`会话 ${id}`}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {reviewable && (
              <Button variant="primary" size="sm" leftIcon={<Pencil size={14} />} onClick={() => setReviewModal(true)}>
                人工复核
              </Button>
            )}
            {qcResult?.verdict === 'violation' && !badcase && (
              <Button variant="danger" size="sm" leftIcon={<AlertTriangle size={14} />} onClick={() => setBadcaseModal(true)}>
                转 badcase
              </Button>
            )}
          </div>
        }
      />

      {detail.error ? (
        <ErrorState error={detail.error} onRetry={detail.refresh} title="会话详情加载失败" />
      ) : (
        <>
          {conversation && (
            <div style={{ marginBottom: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              <div className="card">
                <div className="card__label">渠道</div>
                <div>{labels.channel(conversation.channel)}</div>
              </div>
              <div className="card">
                <div className="card__label">坐席</div>
                <div>{conversation.agent.name}</div>
              </div>
              <div className="card">
                <div className="card__label">客户</div>
                <div>{conversation.customer.name}</div>
              </div>
              <div className="card">
                <div className="card__label">产品</div>
                <div>{conversation.product}</div>
              </div>
              <div className="card">
                <div className="card__label">开始时间</div>
                <div>{formatDateTime(conversation.startedAt)}</div>
              </div>
              <div className="card">
                <div className="card__label">时长</div>
                <div>{formatNumber(conversation.durationSec, 0)} 秒</div>
              </div>
            </div>
          )}

          {qcResult && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>质检结论</h3>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 16 }}>
                <div>
                  <span className="text-13 muted">评分</span>
                  <div><ScoreLine score={qcResult.score} /></div>
                </div>
                <div>
                  <span className="text-13 muted">判定</span>
                  <div><Badge tone={qcResult.verdict === 'violation' ? 'danger' : 'ok'}>{labels.verdict(qcResult.verdict)}</Badge></div>
                </div>
                <div>
                  <span className="text-13 muted">情绪</span>
                  <div><span className={`emotion-text emotion-text--${emotionTone(qcResult.emotion)}`}>{labels.emotion(qcResult.emotion)}</span></div>
                </div>
                <div>
                  <span className="text-13 muted">置信度</span>
                  <div>{qcResult.confidence.toFixed(2)}</div>
                </div>
                {qcResult.needsReview && (
                  <div>
                    <span className="text-13 muted">复核</span>
                    <div><Badge tone="warn">待复核</Badge></div>
                  </div>
                )}
              </div>
              <div className="text-13" style={{ marginBottom: 16 }}>
                <span className="muted">摘要：</span>{qcResult.summary}
              </div>
              {qcResult.tags.length > 0 && (
                <div>
                  <span className="text-13 muted" style={{ display: 'block', marginBottom: 8 }}>标签与证据：</span>
                  <div style={{ display: 'grid', gap: 12 }}>
                    {qcResult.tags.map((tag) => (
                      <TagEvidence
                        key={tag.code}
                        tag={tag}
                        labels={labels}
                        creatingKnowledge={knowledgeSubmitting}
                        onCreateKnowledge={() => void handleCreateKnowledge()}
                        onOpenKnowledge={(entryId) => navigate(`/knowledge/${entryId}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {conversation && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>对话消息</h3>
              <div style={{ display: 'grid', gap: 12 }}>
                {messages.map((msg) => (
                  <MessageBubble key={msg.seq} message={msg} tags={qcResult?.tags ?? []} labels={labels} />
                ))}
              </div>
            </div>
          )}

          {review && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>复核记录</h3>
              <div className="text-13">
                <span className="muted">决策：</span>
                <Badge tone={review.decision === 'confirm' ? 'ok' : review.decision === 'overturn' ? 'danger' : 'warn'}>
                  {review.decision === 'confirm' ? '确认' : review.decision === 'overturn' ? '推翻' : '修正'}
                </Badge>
                {review.note && <><span className="muted" style={{ marginLeft: 12 }}>备注：</span>{review.note}</>}
              </div>
            </div>
          )}

          {badcase && (
            <div className="card" style={{ marginBottom: 24 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>关联 badcase</h3>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <Badge tone={badcase.status === 'closed' ? 'ok' : 'warn'}>{badcase.code}</Badge>
                <span>{badcase.title}</span>
                <Badge tone={severityTone(badcase.severity)}>{badcase.category}</Badge>
                <span className="muted">责任人：{badcase.owner}</span>
              </div>
              <div style={{ marginTop: 12 }}>
                <Timeline entries={badcase.timeline.map((a) => ({
                  key: a.type,
                  at: a.at,
                  label: a.type,
                  by: a.by,
                  note: a.note ?? undefined,
                }))} />
              </div>
            </div>
          )}
        </>
      )}

      {reviewModal && (
        <div className="modal-overlay" onClick={() => setReviewModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>人工复核</h3>
            <FilterGroup label="决策">
              <select
                className="input"
                value={reviewDecision}
                onChange={(e) => setReviewDecision(e.target.value as ReviewDecision)}
              >
                <option value="confirm">确认（维持原判）</option>
                <option value="overturn">推翻（改为通过）</option>
                <option value="amend">修正（调整标签）</option>
              </select>
            </FilterGroup>
            <FilterGroup label="备注">
              <TextArea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="填写复核备注（可选）"
                rows={3}
              />
            </FilterGroup>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setReviewModal(false)}>取消</Button>
              <Button variant="primary" loading={reviewSubmitting} onClick={handleReview}>提交复核</Button>
            </div>
          </div>
        </div>
      )}

      {badcaseModal && (
        <div className="modal-overlay" onClick={() => setBadcaseModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px' }}>创建 badcase</h3>
            <FilterGroup label="归因类别">
              <select
                className="input"
                value={bcCategory}
                onChange={(e) => setBcCategory(e.target.value)}
              >
                <option value="knowledge">知识缺失</option>
                <option value="script">话术问题</option>
                <option value="process">流程问题</option>
                <option value="system">系统问题</option>
              </select>
            </FilterGroup>
            <FilterGroup label="标题">
              <input
                className="input"
                value={bcTitle}
                onChange={(e) => setBcTitle(e.target.value)}
                placeholder="可选，默认自动生成"
              />
            </FilterGroup>
            <FilterGroup label="根因描述">
              <TextArea
                value={bcRootCause}
                onChange={(e) => setBcRootCause(e.target.value)}
                placeholder="描述根因（可选）"
                rows={3}
              />
            </FilterGroup>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button variant="secondary" onClick={() => setBadcaseModal(false)}>取消</Button>
              <Button variant="danger" loading={bcSubmitting} onClick={handleCreateBadcase}>创建</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TagEvidence({
  tag,
  labels,
  creatingKnowledge,
  onCreateKnowledge,
  onOpenKnowledge,
}: {
  tag: QcTag;
  labels: ReturnType<typeof useLabels>;
  creatingKnowledge: boolean;
  onCreateKnowledge: () => void;
  onOpenKnowledge: (entryId: string) => void;
}) {
  return (
    <div style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Badge tone={severityTone(tag.severity)}>{labels.tag(tag.code)}</Badge>
        <span className="text-12 muted">置信度 {tag.confidence.toFixed(2)}</span>
        <span className="text-12 muted">规则 {tag.ruleId}</span>
      </div>
      {tag.evidence.length > 0 && (
        <div style={{ paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
          {tag.evidence.map((ev, i) => (
            <div key={i} className="text-12" style={{ marginBottom: 4 }}>
              <span className="muted">[{ev.seq}]</span> {ev.quote}
              {ev.note && <span className="muted"> — {ev.note}</span>}
            </div>
          ))}
        </div>
      )}
      {tag.code === 'wrong_knowledge' && (
        <div style={{ marginTop: 10 }}>
          {tag.knowledge ? (
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <BookOpen size={14} aria-hidden="true" />
              <span className="mono text-12">{tag.knowledge.code}</span>
              <span className="text-12">{tag.knowledge.title}</span>
              <Badge tone="danger" dot={false}>
                标准 {tag.knowledge.expected} / 陈述 {tag.knowledge.actual}
              </Badge>
              <Button variant="text" size="sm" onClick={() => onOpenKnowledge(tag.knowledge!.entryId)}>
                查看知识条目
              </Button>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                flexWrap: 'wrap',
                padding: '8px 10px',
                borderRadius: 6,
                background: 'var(--surface)',
                border: '1px dashed var(--warn)',
              }}
            >
              <Badge tone="warn" dot={false}>
                知识库未覆盖
              </Badge>
              <span className="text-12 muted">该说法没有已发布事实可对照，建议补录知识条目。</span>
              <Button
                variant="secondary"
                size="sm"
                loading={creatingKnowledge}
                onClick={onCreateKnowledge}
              >
                生成知识完善草稿
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, tags, labels }: { message: { seq: number; role: string; text: string; atSec: number; gapSec?: number | null }; tags: QcTag[]; labels: ReturnType<typeof useLabels> }) {
  const isAgent = message.role === 'agent';
  const matchingTags = tags.filter((tag) => tag.evidence.some((ev) => ev.seq === message.seq));
  const isHighlighted = matchingTags.length > 0;

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: isAgent ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '70%',
          padding: 12,
          borderRadius: 12,
          background: isAgent ? 'var(--primary-soft)' : 'var(--bg-soft)',
          border: isHighlighted ? '2px solid var(--danger)' : '1px solid var(--border)',
        }}
      >
        <div className="text-12 muted" style={{ marginBottom: 4 }}>
          {ROLE_LABELS[message.role] ?? message.role} · {message.atSec}s
          {message.gapSec !== null && message.gapSec !== undefined && <span> · 间隔 {message.gapSec}s</span>}
        </div>
        <div>{message.text}</div>
        {isHighlighted && (
          <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {matchingTags.map((tag) => (
              <Badge key={tag.code} tone={severityTone(tag.severity)}>{labels.tag(tag.code)}</Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
