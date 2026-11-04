import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { SelectOption } from '../lib/labels';

/* --------------------------------- Field ---------------------------------- */

export function Field({
  label,
  required = false,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? <span className="field__error">{error}</span> : null}
      {!error && hint ? <span className="field__hint">{hint}</span> : null}
    </div>
  );
}

/* --------------------------------- Input ---------------------------------- */

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input className={['input', className].filter(Boolean).join(' ')} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return <textarea className={['textarea', className].filter(Boolean).join(' ')} {...rest} />;
}

/* -------------------------------- Select ---------------------------------- */

export function Select({
  value,
  onChange,
  options,
  id,
  ariaLabel,
  className,
  small = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  ariaLabel?: string;
  className?: string;
  small?: boolean;
}) {
  return (
    <span className={['select', small ? 'select--sm' : '', className].filter(Boolean).join(' ')}>
      <select
        id={id}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" />
    </span>
  );
}

/* ------------------------------- SearchInput ------------------------------- */

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索',
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <label className="search-input">
      <Search aria-hidden="true" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

/* --------------------------------- Switch --------------------------------- */

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: string;
}) {
  return (
    <label className="switch" title={description}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span className="switch__track" aria-hidden="true" />
      {label}
    </label>
  );
}

/* -------------------------------- Segmented -------------------------------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={['segmented__item', option.value === value ? 'is-active' : ''].filter(Boolean).join(' ')}
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------- Tabs ---------------------------------- */

export interface TabItem {
  value: string;
  label: ReactNode;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          className={['tabs__item', tab.value === value ? 'is-active' : ''].filter(Boolean).join(' ')}
          onClick={() => {
            onChange(tab.value);
          }}
        >
          {tab.label}
          {typeof tab.count === 'number' ? <span className="tabs__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------- FilterBar ------------------------------- */

export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="filter-bar">
      {children}
      {actions ? (
        <>
          <span className="filter-bar__spacer" />
          <div className="filter-bar__group">{actions}</div>
        </>
      ) : null}
    </div>
  );
}

export function FilterGroup({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="filter-bar__group">
      {label ? <span className="filter-bar__label">{label}</span> : null}
      {children}
    </div>
  );
}
