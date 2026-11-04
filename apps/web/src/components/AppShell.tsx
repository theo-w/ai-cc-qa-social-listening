import { useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  ClipboardCheck,
  Gauge,
  Info,
  LayoutDashboard,
  Lightbulb,
  MessagesSquare,
  RotateCcw,
} from 'lucide-react';
import { errorMessage } from '../api/client';
import { formatRangeLabel } from '../lib/format';
import { useAppData } from '../hooks/useAppData';
import { useQueryState } from '../hooks/useQueryState';
import type { Range } from '../types';
import { Button, IconButton } from './primitives';
import { Segmented } from './forms';
import { ConfirmDialog, useToast } from './overlay';

const NAV_ITEMS = [
  { to: '/', label: '运营总览', icon: LayoutDashboard, end: true },
  { to: '/qc', label: '质检', icon: ClipboardCheck },
  { to: '/knowledge', label: '知识库', icon: BookOpen },
  { to: '/badcases', label: 'badcase', icon: AlertTriangle },
  { to: '/sentiment', label: '舆情', icon: MessagesSquare },
  { to: '/clues', label: '线索', icon: Lightbulb },
  { to: '/eval', label: '评测', icon: Gauge },
  { to: '/about', label: '关于', icon: Info },
];

interface Crumb {
  label: string;
  to?: string;
}

function crumbsFor(pathname: string): Crumb[] {
  const home: Crumb = { label: '运营总览', to: '/' };
  if (pathname === '/') return [{ label: '运营总览' }];
  if (pathname === '/qc') return [home, { label: '质检' }];
  if (pathname.startsWith('/qc/')) return [home, { label: '质检', to: '/qc' }, { label: '会话详情' }];
  if (pathname === '/knowledge') return [home, { label: '知识库' }];
  if (pathname.startsWith('/knowledge/')) {
    return [home, { label: '知识库', to: '/knowledge' }, { label: '知识条目' }];
  }
  if (pathname === '/badcases') return [home, { label: 'badcase' }];
  if (pathname === '/sentiment') return [home, { label: '舆情' }];
  if (pathname.startsWith('/sentiment/alerts/')) {
    return [home, { label: '舆情', to: '/sentiment' }, { label: '预警处置' }];
  }
  if (pathname === '/clues') return [home, { label: '线索' }];
  if (pathname === '/eval') return [home, { label: '评测' }];
  if (pathname === '/about') return [home, { label: '关于' }];
  return [home, { label: '页面不存在' }];
}

const RANGE_OPTIONS: Array<{ value: Range; label: string }> = [
  { value: '7d', label: formatRangeLabel('7d') },
  { value: '14d', label: formatRangeLabel('14d') },
  { value: '30d', label: formatRangeLabel('30d') },
];

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { meta } = useAppData();
  const query = useQueryState();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { resetDemo } = useAppData();

  const isDashboard = location.pathname === '/';
  const rawRange = query.get('range');
  const range: Range = rawRange === '14d' || rawRange === '30d' ? rawRange : '7d';
  const crumbs = crumbsFor(location.pathname);

  const handleReset = async () => {
    setResetting(true);
    try {
      const result = await resetDemo();
      const counts = result.seeded;
      toast.success(
        '演示数据已重置',
        `已重建 ${counts.conversations ?? 0} 个会话、${counts.comments ?? 0} 条评论与全部写入记录。`,
      );
      setResetOpen(false);
    } catch (error) {
      toast.error('重置失败', errorMessage(error));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo" aria-hidden="true">
            QC
          </span>
          <span className="sidebar__brand-text">
            <span className="sidebar__product">QCC Workbench</span>
            <span className="sidebar__edition">客服运营质量管控</span>
          </span>
        </div>
        <nav className="sidebar__nav" aria-label="主导航">
          <div className="sidebar__group-label">运营</div>
          {NAV_ITEMS.slice(0, 7).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => ['sidebar__item', isActive ? 'is-active' : ''].filter(Boolean).join(' ')}
                title={item.label}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
          <div className="sidebar__group-label">系统</div>
          {NAV_ITEMS.slice(7).map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => ['sidebar__item', isActive ? 'is-active' : ''].filter(Boolean).join(' ')}
                title={item.label}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <span className="sidebar__version">v{meta?.version ?? '0.1.1'}</span>
          <span>合成演示数据 · 非真实业务</span>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <nav className="topbar__crumbs" aria-label="面包屑">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {index > 0 ? (
                  <ChevronRight className="topbar__crumb-sep" size={12} aria-hidden="true" />
                ) : null}
                {crumb.to ? <NavLink to={crumb.to}>{crumb.label}</NavLink> : <span className="topbar__current">{crumb.label}</span>}
              </span>
            ))}
          </nav>
          <span className="topbar__spacer" />
          <div className="topbar__actions">
            {isDashboard ? (
              <Segmented
                value={range}
                options={RANGE_OPTIONS}
                ariaLabel="时间范围"
                onChange={(next) => {
                  query.setParams({ range: next }, { replace: true });
                }}
              />
            ) : null}
            <span className="topbar__demo-badge" title="当前为合成演示数据，可随时重置">
              <span className="topbar__demo-dot" aria-hidden="true" />
              演示态
            </span>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RotateCcw size={14} />}
              onClick={() => {
                setResetOpen(true);
              }}
            >
              重置演示数据
            </Button>
          </div>
        </header>

        <main className="app-content">
          <div className="viewport-hint">
            <Info size={14} aria-hidden="true" />
            建议在 1280px 以上宽度使用；当前窗口较窄，内容可横向滚动查看。
          </div>
          <div className="app-content__inner">{children}</div>
        </main>
      </div>

      <ConfirmDialog
        open={resetOpen}
        title="重置演示数据"
        description="该操作会清空所有写操作（复核结论、badcase 处理、预警处置、线索流转）并重建种子数据，且不可撤销。"
        confirmLabel="确认重置"
        danger
        loading={resetting}
        onCancel={() => {
          setResetOpen(false);
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
    </div>
  );
}

/** 顶栏右侧的重置按钮在无 Meta 时也可用，保留独立导出以避免组件耦合。 */
export function TopbarResetAction({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="重置演示数据" onClick={onClick}>
      <RotateCcw size={16} />
    </IconButton>
  );
}
