import { useState } from 'react';
import { fetchEvalDatasets, fetchEvalRuns, runEval, fetchEvalRun } from '../api/client';
import { useApi } from '../hooks/useApi';
import { formatDateTime, formatNumber } from '../lib/format';
import { Badge, Button, EmptyState, PageHeader, ScoreLine } from '../components/primitives';
import { CardBody, CardHead } from '../components/primitives';

export function EvalCenterPage() {
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const datasets = useApi(fetchEvalDatasets, []);
  const runs = useApi(() => fetchEvalRuns((selectedDataset || undefined) as any), [selectedDataset]);
  const runDetail = useApi(() => lastRunId ? fetchEvalRun(lastRunId) : Promise.resolve(null), [lastRunId]);

  const handleRun = async () => {
    if (!selectedDataset) return;
    setRunning(true);
    try {
      const result = await runEval(selectedDataset as any);
      setLastRunId(result.id);
      runs.refresh();
    } catch (error: unknown) {
      console.error('Eval run failed:', error);
    } finally {
      setRunning(false);
    }
  };

  const metricLabels: Record<string, string> = {
    accuracy: '准确率',
    precision: '精确率',
    recall: '召回率',
    f1: 'F1 分数',
    coverage: '覆盖率',
  };

  return (
    <>
      <PageHeader
        title="评测中心"
        subtitle="对质检规则引擎和情绪分析模型进行离线评测，跟踪版本迭代效果。"
      />

      <div className="card" style={{ marginBottom: 24 }}>
        <CardHead
          title="运行评测"
          subtitle="选择数据集并触发评测任务"
          bordered
        />
        <CardBody>
          <div className="filter-bar">
            <div className="filter-bar__group">
              <span className="filter-bar__label">数据集</span>
              <select
                className="input"
                value={selectedDataset}
                onChange={(e) => setSelectedDataset(e.target.value)}
                style={{ minWidth: 200 }}
              >
                <option value="">选择数据集</option>
                {(datasets.data ?? []).map((ds) => (
                  <option key={ds.datasetId} value={ds.dataset}>
                    {ds.description} ({ds.itemCount} 条)
                  </option>
                ))}
              </select>
            </div>
            <div className="filter-bar__group">
              <Button
                variant="primary"
                loading={running}
                disabled={!selectedDataset}
                onClick={handleRun}
              >
                运行评测
              </Button>
            </div>
          </div>
        </CardBody>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <CardHead
          title="评测历史"
          subtitle={selectedDataset ? `数据集 ${selectedDataset}` : '全部数据集'}
          bordered
        />
        <CardBody>
          {runs.loading && !runs.data ? (
            <p className="text-13 muted">加载中…</p>
          ) : (runs.data ?? []).length === 0 ? (
            <EmptyState
              title="暂无评测记录"
              description="选择数据集并运行评测后，历史记录将显示在此处。"
            />
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {(runs.data ?? []).map((run) => (
                <div
                  key={run.id}
                  className="card"
                  style={{ background: 'var(--bg-soft)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, cursor: 'pointer' }}
                  onClick={() => setLastRunId(run.id)}
                >
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <span className="text-12 muted">数据集</span>
                      <div><Badge tone="info">{run.dataset}</Badge></div>
                    </div>
                    <div>
                      <span className="text-12 muted">版本</span>
                      <div className="mono">{run.datasetVersion}</div>
                    </div>
                    <div>
                      <span className="text-12 muted">运行时间</span>
                      <div className="tnum">{formatDateTime(run.runAt)}</div>
                    </div>
                    <div>
                      <span className="text-12 muted">耗时</span>
                      <div>{formatNumber(run.durationMs, 0)} ms</div>
                    </div>
                    <div>
                      <span className="text-12 muted">模型</span>
                      <div className="mono">{run.modelVersion}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                      {Object.entries(run.metrics).slice(0, 4).map(([key, value]) => (
                        <div key={key}>
                          <span className="text-12 muted">{metricLabels[key] ?? key}</span>
                          <div><ScoreLine score={value * 100} /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </div>

      {runDetail.data && (
        <div className="card" style={{ marginBottom: 24 }}>
          <CardHead
            title="评测详情"
            subtitle={`${runDetail.data.dataset} · ${runDetail.data.datasetVersion}`}
            bordered
            actions={
              <Button variant="secondary" size="sm" onClick={() => setLastRunId(null)}>关闭</Button>
            }
          />
          <CardBody>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
              <div>
                <span className="text-13 muted">运行时间</span>
                <div className="tnum">{formatDateTime(runDetail.data.runAt)}</div>
              </div>
              <div>
                <span className="text-13 muted">耗时</span>
                <div>{formatNumber(runDetail.data.durationMs, 0)} ms</div>
              </div>
              <div>
                <span className="text-13 muted">模型版本</span>
                <div className="mono">{runDetail.data.modelVersion}</div>
              </div>
              <div>
                <span className="text-13 muted">数据集版本</span>
                <div className="mono">{runDetail.data.datasetVersion}</div>
              </div>
            </div>

            <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>指标</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
              {Object.entries(runDetail.data.metrics).map(([key, value]) => (
                <div key={key} className="card" style={{ background: 'var(--bg-soft)', padding: 12, borderRadius: 8 }}>
                  <span className="text-12 muted">{metricLabels[key] ?? key}</span>
                  <div><ScoreLine score={value * 100} /></div>
                </div>
              ))}
            </div>

            <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>阈值检查</h4>
            <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
              {Object.entries(runDetail.data.thresholdsMet).map(([key, met]) => (
                <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge tone={met ? 'ok' : 'danger'}>{met ? '通过' : '未通过'}</Badge>
                  <span className="text-13">{key}</span>
                </div>
              ))}
            </div>

            {runDetail.data.summary && (
              <>
                <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>摘要</h4>
                <p className="text-13" style={{ marginBottom: 24 }}>{runDetail.data.summary}</p>
              </>
            )}

            {runDetail.data.mismatches.length > 0 && (
              <>
                <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>不匹配项 ({runDetail.data.mismatches.length})</h4>
                <div style={{ display: 'grid', gap: 8 }}>
                  {runDetail.data.mismatches.slice(0, 20).map((mismatch) => (
                    <div key={mismatch.itemId} style={{ padding: 12, background: 'var(--bg-soft)', borderRadius: 8 }}>
                      <div className="text-12 muted">ID: {mismatch.itemId}</div>
                      <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                        <div><span className="muted">期望：</span>{mismatch.expected}</div>
                        <div><span className="muted">实际：</span>{mismatch.predicted}</div>
                        <div><span className="muted">原因：</span>{mismatch.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </div>
      )}
    </>
  );
}
