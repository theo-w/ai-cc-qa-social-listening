import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { Button, IconButton } from './primitives';

/* ------------------------------ dialog 行为 ------------------------------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useDialogBehavior(
  open: boolean,
  onClose: (() => void) | undefined,
  panelRef: RefObject<HTMLDivElement | null>,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null,
      );
      if (nodes.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      previous?.focus();
    };
  }, [open, panelRef]);
}

/* --------------------------------- Drawer --------------------------------- */

export function Drawer({
  open,
  title,
  meta,
  onClose,
  children,
  footer,
  ariaLabel,
}: {
  open: boolean;
  title: ReactNode;
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  ariaLabel?: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogBehavior(open, onClose, panelRef);

  if (!open) return null;

  return (
    <>
      <div className="overlay overlay--drawer" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : '详情')}
        tabIndex={-1}
      >
        <div className="drawer__head">
          <div style={{ minWidth: 0 }}>
            <h2 className="drawer__title">{title}</h2>
            {meta ? <div className="drawer__meta">{meta}</div> : null}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="drawer__body">{children}</div>
        {footer ? <div className="drawer__foot">{footer}</div> : null}
      </div>
    </>
  );
}

/* ---------------------------------- Modal --------------------------------- */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogBehavior(open, onClose, panelRef);

  if (!open) return null;

  return (
    <>
      <div className="overlay overlay--modal" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={['modal', wide ? 'modal--wide' : ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : '对话框'}
        tabIndex={-1}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title">{title}</h2>
            {description ? <p className="modal__desc">{description}</p> : null}
          </div>
          <IconButton label="关闭" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="modal__body">{children}</div>
        {footer ? <div className="modal__foot">{footer}</div> : null}
      </div>
    </>
  );
}

/* ------------------------------ ConfirmDialog ------------------------------ */

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ?? <p className="text-13 muted">请确认是否继续该操作。</p>}
    </Modal>
  );
}

/* ---------------------------------- Toast --------------------------------- */

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

export interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TOAST_ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} satisfies Record<ToastKind, typeof Info>;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const sequence = useRef(0);

  const push = useCallback((kind: ToastKind, title: string, description?: string) => {
    sequence.current += 1;
    const id = sequence.current;
    setItems((current) => [...current, { id, kind, title, description }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4000);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => {
        push('success', title, description);
      },
      error: (title, description) => {
        push('error', title, description);
      },
      info: (title, description) => {
        push('info', title, description);
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" role="region" aria-live="polite" aria-label="通知">
        {items.map((item) => {
          const Icon = TOAST_ICONS[item.kind];
          return (
            <div key={item.id} className={`toast toast--${item.kind}`}>
              <Icon aria-hidden="true" />
              <div className="toast__content">
                <div className="toast__title">{item.title}</div>
                {item.description ? <div className="toast__desc">{item.description}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast 必须在 ToastProvider 内使用');
  return context;
}
