import { formatDateTime } from '../lib/format';
import type { Tone } from '../lib/labels';

export interface TimelineEntry {
  key: string;
  at: string;
  label: string;
  by?: string;
  note?: string | null;
  tone?: Tone;
}

const TONE_CLASS: Record<Tone, string> = {
  ok: 'timeline__item--ok',
  warn: 'timeline__item--warn',
  danger: 'timeline__item--danger',
  info: 'timeline__item--info',
  primary: 'timeline__item--accent',
  muted: '',
  neutral: '',
};

/** 时间线：最新在上，竖线 + 圆点，展示时间 / 操作人 / 动作 / 备注。 */
export function Timeline({ entries, emptyText = '暂无处理记录' }: { entries: TimelineEntry[]; emptyText?: string }) {
  if (entries.length === 0) {
    return <p className="text-13 muted">{emptyText}</p>;
  }
  const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <ol className="timeline">
      {sorted.map((entry) => (
        <li key={entry.key} className={['timeline__item', TONE_CLASS[entry.tone ?? 'muted']].filter(Boolean).join(' ')}>
          <span className="timeline__dot" aria-hidden="true" />
          <div className="timeline__head">
            <span className="timeline__type">{entry.label}</span>
            {entry.by ? <span className="timeline__by">{entry.by}</span> : null}
            <time className="timeline__time tnum" dateTime={entry.at}>
              {formatDateTime(entry.at)}
            </time>
          </div>
          {entry.note ? <p className="timeline__note">{entry.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}
