import { useState } from 'react';
import { errorMessage } from '../api/client';
import { useAppData } from '../hooks/useAppData';
import { formatDateTime } from '../lib/format';
import { Badge, Button, PageHeader } from '../components/primitives';
import { Card, CardBody, CardHead } from '../components/primitives';
import { ConfirmDialog, useToast } from '../components/overlay';

export function AboutPage() {
  const { meta, now, resetDemo } = useAppData();
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [lastResetAt, setLastResetAt] = useState<string | null>(null);

  // 只在用户确认后执行重置；进入页面本身不得触发任何写操作。
  const handleReset = async () => {
    setResetting(true);
    try {
      const result = await resetDemo();
      setLastResetAt(result.resetAt);
      toast.success(
        '演示数据已重置',
        `已重建 ${result.seeded.conversations ?? 0} 个会话、${result.seeded.comments ?? 0} 条评论与全部写入记录。`,
      );
      setConfirmOpen(false);
    } catch (error) {
      toast.error('重置失败', errorMessage(error));
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="关于"
        subtitle="系统信息、数据版本与操作入口。"
      />

      <div className="grid-2">
        <Card>
          <CardHead title="系统信息" bordered />
          <CardBody>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <span className="text-13 muted">产品名称</span>
                <div>{meta?.product ?? '—'}</div>
              </div>
              <div>
                <span className="text-13 muted">前端版本</span>
                <div className="mono">v{meta?.version ?? '—'}</div>
              </div>
              <div>
                <span className="text-13 muted">规则引擎版本</span>
                <div className="mono">{meta?.modelVersion ?? '—'}</div>
              </div>
              <div>
                <span className="text-13 muted">数据生成时间</span>
                <div className="tnum">{formatDateTime(meta?.generatedAt)}</div>
              </div>
              <div>
                <span className="text-13 muted">演示时刻</span>
                <div className="tnum">{formatDateTime(new Date(now).toISOString())}</div>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="演示数据" bordered />
          <CardBody>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <span className="text-13 muted">数据版本</span>
                <div><Badge tone="info">{meta?.demo.datasetVersion ?? '—'}</Badge></div>
              </div>
              <div>
                <span className="text-13 muted">会话数量</span>
                <div>{meta?.demo.itemCounts?.qc ?? '—'}</div>
              </div>
              <div>
                <span className="text-13 muted">评论数量</span>
                <div>{meta?.demo.itemCounts?.sentiment ?? '—'}</div>
              </div>
              <div>
                <span className="text-13 muted">重置状态</span>
                <div>
                  {lastResetAt ? (
                    <Badge tone="ok">已重置于 {formatDateTime(lastResetAt)}</Badge>
                  ) : (
                    <span className="muted">未重置</span>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <Button
                  variant="danger"
                  loading={resetting}
                  disabled={!meta?.demo.resetAvailable}
                  onClick={() => {
                    setConfirmOpen(true);
                  }}
                >
                  重置演示数据
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="角色与责任人" bordered />
          <CardBody>
            <div style={{ display: 'grid', gap: 8 }}>
              {(meta?.owners ?? []).map((owner) => (
                <div key={owner.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge tone="info">{owner.role}</Badge>
                  <span>{owner.name}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="质检标签体系" bordered />
          <CardBody>
            <div style={{ display: 'grid', gap: 8 }}>
              {(meta?.tagTaxonomy ?? []).map((tag) => (
                <div key={tag.code} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Badge tone={tag.severity === 'high' ? 'danger' : tag.severity === 'medium' ? 'warn' : 'muted'}>
                    {tag.code}
                  </Badge>
                  <span>{tag.name}</span>
                  {tag.weight && <span className="text-12 muted">权重 {tag.weight}</span>}
                  {tag.description && <span className="text-12 muted">— {tag.description}</span>}
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="重置演示数据"
        description="该操作会清空所有写操作（复核结论、badcase 处理、预警处置、线索流转）并重建种子数据，且不可撤销。"
        confirmLabel="确认重置"
        danger
        loading={resetting}
        onCancel={() => {
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          void handleReset();
        }}
      >
        <ul style={{ paddingLeft: 18, listStyle: 'disc', display: 'grid', gap: 6, color: 'var(--ink-soft)' }}>
          <li>演示时间、统计口径会回到初始状态</li>
          <li>当前页面将自动重新加载数据</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}
