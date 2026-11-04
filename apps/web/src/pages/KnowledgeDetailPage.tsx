import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ClipboardList, Pencil, Power, RefreshCcw, ShieldCheck } from 'lucide-react';
import {
  errorMessage,
  fetchKnowledgeDetail,
  offlineKnowledge,
  publishKnowledge,
  recheckKnowledge,
  reviseKnowledge,
} from '../api/client';
import { useApi } from '../hooks/useApi';
import {
  knowledgeSourceTone,
  knowledgeStatusTone,
  severityTone,
  useLabels,
} from '../lib/labels';
import { formatDateTime, formatRatio } from '../lib/format';
import type {
  KnowledgeCategory,
  KnowledgeFact,
  KnowledgeFactCompare,
  KnowledgeFactInput,
  KnowledgeRecheck,
} from '../types';
import { Badge, Button, ErrorState, PageHeader } from '../components/primitives';
import { Select, TextArea, TextInput } from '../components/forms';
import { ConfirmDialog, Modal, useToast } from '../components/overlay';

const CATEGORY_VALUES: KnowledgeCategory[] = ['refund', 'recharge', 'activity', 'version', 'account', 'other'];
const COMPARE_VALUES: KnowledgeFactCompare[] = ['number', 'duration_minutes', 'date', 'text'];

interface FactDraft {
  key: string;
  label: string;
  expected: string;
  compare: KnowledgeFactCompare;
  expectedNumber: string;
  expectedMinutes: string;
  expectedMonth: string;
  expectedDay: string;
  unit: string;
  claimPatterns: string;
  violationPatterns: string;
  note: string;
}

function toDraft(fact: KnowledgeFact): FactDraft {
  return {
    key: fact.key,
    label: fact.label,
    expected: fact.expected,
    compare: fact.compare,
    expectedNumber: fact.expectedNumber === null || fact.expectedNumber === undefined ? '' : String(fact.expectedNumber),
    expectedMinutes:
      fact.expectedMinutes === null || fact.expectedMinutes === undefined ? '' : String(fact.expectedMinutes),
    expectedMonth: fact.expectedMonth === null || fact.expectedMonth === undefined ? '' : String(fact.expectedMonth),
    expectedDay: fact.expectedDay === null || fact.expectedDay === undefined ? '' : String(fact.expectedDay),
    unit: fact.unit ?? '',
    claimPatterns: fact.claimPatterns.join('\n'),
    violationPatterns: fact.violationPatterns.join('\n'),
    note: fact.note ?? '',
  };
}

function newDraft(index: number): FactDraft {
  return {
    key: `custom_fact_${index}`,
    label: '',
    expected: '',
    compare: 'text',
    expectedNumber: '',
    expectedMinutes: '',
    expectedMonth: '',
    expectedDay: '',
    unit: '',
    claimPatterns: '',
    violationPatterns: '',
    note: '',
  };
}

function toFactInput(draft: FactDraft, index: number): KnowledgeFactInput {
  const toNumber = (value: string): number | null => {
    if (value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const toLines = (value: string): string[] =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  return {
    key: draft.key.trim() || `custom_fact_${index + 1}`,
    label: draft.label.trim(),
    expected: draft.expected.trim(),
    compare: draft.compare,
    expectedNumber: toNumber(draft.expectedNumber),
    expectedMinutes: toNumber(draft.expectedMinutes),
    expectedMonth: toNumber(draft.expectedMonth),
    expectedDay: toNumber(draft.expectedDay),
    unit: draft.unit.trim() || null,
    claimPatterns: toLines(draft.claimPatterns),
    violationPatterns: toLines(draft.violationPatterns),
    note: draft.note.trim() || null,
  };
}

function recheckSummary(recheck: KnowledgeRecheck): string {
  return `复测 ${recheck.rechecked} 通，${recheck.changed} 通变化；知识缺口 ${recheck.before.gaps} → ${recheck.after.gaps}，关联率 ${formatRatio(
    recheck.before.knowledgeTags === 0 ? 0 : recheck.before.linkedKnowledgeTags / recheck.before.knowledgeTags,
  )} → ${formatRatio(
    recheck.after.knowledgeTags === 0 ? 0 : recheck.after.linkedKnowledgeTags / recheck.after.knowledgeTags,
  )}`;
}

export function KnowledgeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const labels = useLabels();
  const toast = useToast();

  const detail = useApi(() => (id ? fetchKnowledgeDetail(id) : Promise.resolve(null)), [id]);
  const data = detail.data;
  const entry = data?.entry;

  const [reviseOpen, setReviseOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [actionNote, setActionNote] = useState('');
  const [lastRecheck, setLastRecheck] = useState<KnowledgeRecheck | null>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<KnowledgeCategory>('other');
  const [content, setContent] = useState('');
  const [keywords, setKeywords] = useState('');
  const [note, setNote] = useState('');
  const [facts, setFacts] = useState<FactDraft[]>([]);

  useEffect(() => {
    if (!entry) return;
    setTitle(entry.title);
    setCategory(entry.category);
    setContent(entry.content);
    setKeywords(entry.keywords.join(', '));
    setFacts(entry.facts.map(toDraft));
    setNote('');
  }, [entry]);

  const statusTone = entry ? knowledgeStatusTone(entry.status) : 'muted';
  const canPublish = entry ? entry.facts.some((fact) => fact.claimPatterns.length > 0 || fact.violationPatterns.length > 0) : false;

  const hits = data?.hits ?? [];
  const badcases = data?.badcases ?? [];

  const linkedConversationCount = useMemo(() => new Set(hits.map((hit) => hit.conversationId)).size, [hits]);

  const openRevise = () => {
    if (!entry) return;
    setTitle(entry.title);
    setCategory(entry.category);
    setContent(entry.content);
    setKeywords(entry.keywords.join(', '));
    setFacts(entry.facts.map(toDraft));
    setNote('');
    setReviseOpen(true);
  };

  const handleRevise = async () => {
    if (!id || !entry) return;
    if (title.trim() === '' || content.trim() === '') {
      toast.error('信息不完整', '标题与标准口径不能为空。');
      return;
    }
    if (facts.some((fact) => fact.label.trim() === '' || fact.expected.trim() === '')) {
      toast.error('事实信息不完整', '每条事实都需要填写名称与标准值。');
      return;
    }
    setSaving(true);
    try {
      await reviseKnowledge(id, {
        title: title.trim(),
        category,
        content: content.trim(),
        keywords: keywords
          .split(/[,，\s]+/)
          .map((item) => item.trim())
          .filter(Boolean),
        note: note.trim() || undefined,
        facts: facts.map(toFactInput),
      });
      setReviseOpen(false);
      detail.refresh();
      toast.success('修订已保存', entry.status === 'draft' ? '草稿已更新。' : '已生成新版本并回到草稿，发布后生效。');
    } catch (error) {
      toast.error('保存失败', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const result = await publishKnowledge(id, { by: '顾清', note: actionNote.trim() || undefined });
      setLastRecheck(result.recheck);
      setPublishOpen(false);
      setActionNote('');
      detail.refresh();
      toast.success('已发布并完成复测', recheckSummary(result.recheck));
    } catch (error) {
      toast.error('发布失败', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleOffline = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const result = await offlineKnowledge(id, { by: '顾清', note: actionNote.trim() || undefined });
      setLastRecheck(result.recheck);
      setOfflineOpen(false);
      setActionNote('');
      detail.refresh();
      toast.success('已下线并完成复测', recheckSummary(result.recheck));
    } catch (error) {
      toast.error('下线失败', errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleRecheck = async () => {
    if (!id) return;
    setRechecking(true);
    try {
      const result = await recheckKnowledge(id);
      setLastRecheck(result);
      detail.refresh();
      toast.success('复测完成', recheckSummary(result));
    } catch (error) {
      toast.error('复测失败', errorMessage(error));
    } finally {
      setRechecking(false);
    }
  };

  if (detail.error) {
    return <ErrorState error={detail.error} onRetry={detail.refresh} title="知识条目加载失败" />;
  }

  if (!entry) {
    return <ErrorState error="加载中" onRetry={detail.refresh} title="知识条目加载失败" />;
  }

  const statusActions = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button variant="secondary" size="sm" leftIcon={<Pencil size={14} />} onClick={openRevise}>
        编辑修订
      </Button>
      {entry.status === 'published' ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCcw size={14} />}
            loading={rechecking}
            onClick={() => void handleRecheck()}
          >
            复测
          </Button>
          <Button variant="danger" size="sm" leftIcon={<Power size={14} />} onClick={() => setOfflineOpen(true)}>
            下线
          </Button>
        </>
      ) : (
        <Button
          variant="primary"
          size="sm"
          leftIcon={<ShieldCheck size={14} />}
          disabled={!canPublish}
          title={canPublish ? undefined : '请先补齐至少 1 条可校验事实'}
          onClick={() => setPublishOpen(true)}
        >
          发布
        </Button>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            <span className="mono">{entry.code}</span>
            <span>{entry.title}</span>
          </span>
        }
        subtitle="知识条目详情：标准口径、事实校验、质检证据与版本历史。"
        actions={statusActions}
        meta={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="text" size="sm" leftIcon={<ArrowLeft size={14} />} onClick={() => navigate('/knowledge')}>
              返回知识库
            </Button>
            <Badge tone={statusTone}>{labels.knowledgeStatus(entry.status)}</Badge>
            <Badge tone="info" dot={false}>
              v{entry.version}
            </Badge>
            <Badge tone="muted" dot={false}>
              {labels.knowledgeCategory(entry.category)}
            </Badge>
            <Badge tone={knowledgeSourceTone(entry.source)} dot={false}>
              {labels.knowledgeSource(entry.source)}
            </Badge>
          </div>
        }
      />

      {lastRecheck && (
        <div className="card" style={{ marginBottom: 20, borderLeft: '3px solid var(--primary)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
            <CheckCircle2 size={16} color="var(--primary)" />
            <strong>最近一次复测</strong>
            <span className="text-12 muted">{recheckSummary(lastRecheck)}</span>
          </div>
          {lastRecheck.changes.length > 0 ? (
            <div className="text-12 muted" style={{ display: 'grid', gap: 4 }}>
              {lastRecheck.changes.map((change) => (
                <span key={change.conversationId}>
                  {change.conversationId}：{change.beforeTags.join(' / ') || '无标签'} →{' '}
                  {change.afterTags.join(' / ') || '无标签'}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-12 muted" style={{ margin: 0 }}>
              标签与知识引用未发生变化；已人工复核的会话不会被覆盖。
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(300px, 1fr)', gap: 20 }}>
        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <section className="card">
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>标准口径</h3>
            <p style={{ margin: '0 0 12px', whiteSpace: 'pre-wrap' }}>{entry.content}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {entry.keywords.map((keyword) => (
                <Badge key={keyword} tone="muted" dot={false}>
                  {keyword}
                </Badge>
              ))}
              <span className="text-12 muted">责任人：{entry.owner}</span>
              <span className="text-12 muted">更新：{formatDateTime(entry.updatedAt)}</span>
              {entry.sourceRef && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => {
                    if (entry.sourceRef?.type === 'conversation') navigate(`/qc/${entry.sourceRef.id}`);
                    if (entry.sourceRef?.type === 'badcase') navigate(`/badcases/${entry.sourceRef.id}`);
                  }}
                >
                  来源：{entry.sourceRef.label || entry.sourceRef.id}
                </Button>
              )}
            </div>
          </section>

          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>事实与识别规则</h3>
              <span className="text-12 muted">
                {entry.facts.length} 条 · {canPublish ? '已具备发布条件' : '发布前需补齐识别正则'}
              </span>
            </div>
            {entry.facts.length === 0 ? (
              <p className="text-13 muted" style={{ margin: 0 }}>
                暂无结构化事实。草稿可以保存，但必须补齐至少 1 条可校验事实才能发布。
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {entry.facts.map((fact) => (
                  <div
                    key={fact.key}
                    style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 8, display: 'grid', gap: 6 }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{fact.label}</strong>
                      <Badge tone="info" dot={false}>
                        {labels.knowledgeCompare(fact.compare)}
                      </Badge>
                      <span className="text-12">标准值：<span className="mono">{fact.expected}</span></span>
                    </div>
                    <details className="text-12 muted">
                      <summary style={{ cursor: 'pointer' }}>识别规则</summary>
                      <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                        {fact.claimPatterns.length > 0 && (
                          <div>
                            <span className="muted">陈述提取：</span>
                            {fact.claimPatterns.map((pattern) => (
                              <code key={pattern} style={{ display: 'block', wordBreak: 'break-all' }}>
                                {pattern}
                              </code>
                            ))}
                          </div>
                        )}
                        {fact.violationPatterns.length > 0 && (
                          <div>
                            <span className="muted">直接违规：</span>
                            {fact.violationPatterns.map((pattern) => (
                              <code key={pattern} style={{ display: 'block', wordBreak: 'break-all' }}>
                                {pattern}
                              </code>
                            ))}
                          </div>
                        )}
                        {fact.note && <div>说明：{fact.note}</div>}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>质检证据</h3>
              <span className="text-12 muted">
                {hits.length} 条证据 · {linkedConversationCount} 通会话
              </span>
            </div>
            {hits.length === 0 ? (
              <p className="text-13 muted" style={{ margin: 0 }}>
                暂无质检命中。发布后复测，或命中相关说法后会出现在这里。
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {hits.map((hit) => (
                  <div
                    key={`${hit.conversationId}-${hit.seq}-${hit.quote}`}
                    style={{ padding: 10, borderRadius: 8, background: 'var(--bg-soft)' }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Button variant="text" size="sm" onClick={() => navigate(`/qc/${hit.conversationId}`)}>
                        {hit.conversationId}
                      </Button>
                      <span className="text-12 muted">坐席 {hit.agentName} · seq {hit.seq}</span>
                      <Badge tone="danger" dot={false}>
                        标准 {hit.expected} / 实际 {hit.actual}
                      </Badge>
                    </div>
                    <p className="text-13" style={{ margin: '6px 0 0' }}>
                      「{hit.quote}」
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>关联 badcase</h3>
            {badcases.length === 0 ? (
              <p className="text-13 muted" style={{ margin: 0 }}>
                暂无关联 badcase。知识类 badcase 可在详情页生成知识完善草稿。
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {badcases.map((badcase) => (
                  <div
                    key={badcase.id}
                    style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10, background: 'var(--bg-soft)', borderRadius: 8 }}
                  >
                    <Button variant="text" size="sm" onClick={() => navigate(`/badcases/${badcase.id}`)}>
                      {badcase.code}
                    </Button>
                    <span>{badcase.title}</span>
                    <Badge tone={badcase.status === 'closed' ? 'ok' : 'warn'} dot={false}>
                      {labels.badcaseStatus(badcase.status)}
                    </Badge>
                    <Badge tone={severityTone(badcase.severity)} dot={false}>
                      {labels.severity(badcase.severity)}
                    </Badge>
                    <span className="text-12 muted">责任人：{badcase.owner}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <section className="card">
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>条目信息</h3>
            <div style={{ display: 'grid', gap: 8 }} className="text-13">
              <div><span className="muted">编号：</span><span className="mono">{entry.code}</span></div>
              <div><span className="muted">分类：</span>{labels.knowledgeCategory(entry.category)}</div>
              <div><span className="muted">状态：</span>{labels.knowledgeStatus(entry.status)}</div>
              <div><span className="muted">版本：</span>v{entry.version}</div>
              <div><span className="muted">来源：</span>{labels.knowledgeSource(entry.source)}</div>
              <div><span className="muted">责任人：</span>{entry.owner}</div>
              <div><span className="muted">创建：</span>{formatDateTime(entry.createdAt)}</div>
              <div><span className="muted">发布：</span>{entry.publishedAt ? formatDateTime(entry.publishedAt) : '—'}</div>
            </div>
          </section>

          <section className="card">
            <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>版本历史</h3>
            <div style={{ display: 'grid', gap: 10 }}>
              {[...entry.revisions].reverse().map((revision) => (
                <div key={revision.version} style={{ paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong className="tnum">v{revision.version}</strong>
                    <Badge tone={knowledgeStatusTone(revision.status)} dot={false}>
                      {labels.knowledgeStatus(revision.status)}
                    </Badge>
                    <span className="text-12 muted">{revision.by} · {formatDateTime(revision.at)}</span>
                  </div>
                  <p className="text-12" style={{ margin: '4px 0 0' }}>{revision.note || '—'}</p>
                  <details className="text-12 muted">
                    <summary style={{ cursor: 'pointer' }}>查看该版本口径（{revision.facts.length} 条事实）</summary>
                    <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{revision.content}</p>
                  </details>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>知识完善提示</h3>
            <div className="text-12 muted" style={{ display: 'grid', gap: 6 }}>
              <span><ClipboardList size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />发布后自动复测全部未复核会话。</span>
              <span><ShieldCheck size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />人工已复核结论不会被覆盖。</span>
              <span><RefreshCcw size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />修订会回到草稿，发布前该条目不参与质检。</span>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={reviseOpen}
        title={entry.status === 'draft' ? '编辑草稿' : '创建修订'}
        description={
          entry.status === 'draft'
            ? '草稿修订会直接更新当前版本。'
            : `保存后生成 v${entry.version + 1} 草稿，旧版本保留在版本历史；发布前该条目暂停参与质检。`
        }
        onClose={() => setReviseOpen(false)}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviseOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void handleRevise()}>
              保存修订
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <label className="field">
              <span className="field__label">标题</span>
              <TextInput value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
            </label>
            <label className="field">
              <span className="field__label">分类</span>
              <Select
                value={category}
                ariaLabel="知识分类"
                options={CATEGORY_VALUES.map((value) => ({ value, label: labels.knowledgeCategory(value) }))}
                onChange={(value) => setCategory(value as KnowledgeCategory)}
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">标准口径</span>
            <TextArea value={content} onChange={(event) => setContent(event.target.value)} rows={4} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label className="field">
              <span className="field__label">关键词（逗号分隔）</span>
              <TextInput value={keywords} onChange={(event) => setKeywords(event.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">修订说明</span>
              <TextInput
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="为什么改、依据哪条公告 / 质检证据"
              />
            </label>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong className="text-13">结构化事实</strong>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFacts((previous) => [...previous, newDraft(previous.length)])}
              >
                添加事实
              </Button>
            </div>
            {facts.length === 0 ? (
              <p className="text-12 muted" style={{ margin: 0 }}>至少添加 1 条事实后才能发布。</p>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {facts.map((fact, index) => (
                  <div key={`${fact.key}-${index}`} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, display: 'grid', gap: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.6fr 1fr auto', gap: 8, alignItems: 'end' }}>
                      <label className="field">
                        <span className="field__label">事实名称</span>
                        <TextInput
                          value={fact.label}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, label: event.target.value } : item)),
                            )
                          }
                          placeholder="退款手续费"
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">标准值（展示）</span>
                        <TextInput
                          value={fact.expected}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, expected: event.target.value } : item)),
                            )
                          }
                          placeholder="0%（不收取手续费）"
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">比对方式</span>
                        <Select
                          value={fact.compare}
                          ariaLabel="比对方式"
                          options={COMPARE_VALUES.map((value) => ({ value, label: labels.knowledgeCompare(value) }))}
                          onChange={(value) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, compare: value as KnowledgeFactCompare } : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFacts((previous) => previous.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        删除
                      </Button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
                      <label className="field">
                        <span className="field__label">期望数值</span>
                        <TextInput
                          value={fact.expectedNumber}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, expectedNumber: event.target.value } : item)),
                            )
                          }
                          placeholder="0"
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">期望分钟</span>
                        <TextInput
                          value={fact.expectedMinutes}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, expectedMinutes: event.target.value } : item)),
                            )
                          }
                          placeholder="1440"
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">期望月</span>
                        <TextInput
                          value={fact.expectedMonth}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, expectedMonth: event.target.value } : item)),
                            )
                          }
                          placeholder="11"
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">期望日</span>
                        <TextInput
                          value={fact.expectedDay}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, expectedDay: event.target.value } : item)),
                            )
                          }
                          placeholder="5"
                        />
                      </label>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 0.6fr', gap: 8 }}>
                      <label className="field">
                        <span className="field__label">陈述提取正则（每行一条）</span>
                        <TextArea
                          value={fact.claimPatterns}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, claimPatterns: event.target.value } : item)),
                            )
                          }
                          rows={3}
                          placeholder={'退款[^。！？]{0,10}?手续费[^。！？]{0,10}?(\\d{1,3})\\s*%'}
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">直接违规正则（每行一条）</span>
                        <TextArea
                          value={fact.violationPatterns}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, violationPatterns: event.target.value } : item)),
                            )
                          }
                          rows={3}
                          placeholder="公告是旧的"
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">单位 / 说明</span>
                        <TextInput
                          value={fact.unit}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, unit: event.target.value } : item)),
                            )
                          }
                          placeholder="%"
                        />
                        <TextInput
                          value={fact.note}
                          onChange={(event) =>
                            setFacts((previous) =>
                              previous.map((item, itemIndex) => (itemIndex === index ? { ...item, note: event.target.value } : item)),
                            )
                          }
                          placeholder="口径说明"
                          style={{ marginTop: 6 }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={publishOpen}
        title="发布知识条目"
        description="发布后将参与质检，并自动复测全部未复核会话（已人工复核的结论不会改变）。"
        confirmLabel="发布并复测"
        loading={saving}
        onCancel={() => setPublishOpen(false)}
        onConfirm={() => void handlePublish()}
      >
        <label className="field">
          <span className="field__label">发布说明（可选）</span>
          <TextArea
            value={actionNote}
            onChange={(event) => setActionNote(event.target.value)}
            rows={3}
            placeholder="如：已核对 2026-10-28 官方公告"
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={offlineOpen}
        title="下线知识条目"
        description="下线后该条目不参与质检，并自动复测全部未复核会话。历史版本仍保留。"
        confirmLabel="下线并复测"
        danger
        loading={saving}
        onCancel={() => setOfflineOpen(false)}
        onConfirm={() => void handleOffline()}
      >
        <label className="field">
          <span className="field__label">下线说明（可选）</span>
          <TextArea value={actionNote} onChange={(event) => setActionNote(event.target.value)} rows={3} />
        </label>
      </ConfirmDialog>
    </>
  );
}
