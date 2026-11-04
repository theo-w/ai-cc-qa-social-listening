import type { KeyboardEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SkeletonTable } from './primitives';

/* -------------------------------- DataTable -------------------------------- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  center?: boolean;
  width?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  loading = false,
  skeletonRows = 6,
  empty,
  caption,
}: {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  empty: ReactNode;
  caption?: string;
}) {
  if (loading) {
    return (
      <div className="table-card">
        <SkeletonTable rows={skeletonRows} />
      </div>
    );
  }

  return (
    <div className="table-card">
      <div className="table-wrap">
        <table className="data-table">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={[column.numeric ? 'is-numeric' : '', column.center ? 'is-center' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ height: 'auto', padding: 0 }}>
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
                  if (!onRowClick) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onRowClick(row);
                  }
                };
                return (
                  <tr
                    key={rowKey(row)}
                    className={[onRowClick ? 'is-clickable' : '', rowClassName ? rowClassName(row) : '']
                      .filter(Boolean)
                      .join(' ')}
                    tabIndex={onRowClick ? 0 : undefined}
                    onClick={
                      onRowClick
                        ? () => {
                            onRowClick(row);
                          }
                        : undefined
                    }
                    onKeyDown={handleKeyDown}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={[column.numeric ? 'is-numeric' : '', column.center ? 'is-center' : '', column.className ?? '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------- Pagination ------------------------------- */

function buildPageList(current: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages: Array<number | 'gap'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  if (start > 2) pages.push('gap');
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < totalPages - 1) pages.push('gap');
  pages.push(totalPages);
  return pages;
}

export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pages = buildPageList(safePage, totalPages);

  return (
    <nav className="pagination" aria-label="分页">
      <span>
        共 {total} 条 · 每页 {pageSize} 条
      </span>
      <div className="pagination__pages">
        <button
          type="button"
          className="page-btn"
          aria-label="上一页"
          disabled={safePage <= 1}
          onClick={() => {
            onChange(safePage - 1);
          }}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        {pages.map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className="page-btn" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={['page-btn', item === safePage ? 'is-current' : ''].filter(Boolean).join(' ')}
              aria-current={item === safePage ? 'page' : undefined}
              onClick={() => {
                onChange(item);
              }}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          className="page-btn"
          aria-label="下一页"
          disabled={safePage >= totalPages}
          onClick={() => {
            onChange(safePage + 1);
          }}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
