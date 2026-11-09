'use client';

import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';

/**
 * The search and filter controls of a list (task 05B), in a labelled search landmark. "Clear
 * filters" appears only while something is filtered.
 */
export function ListFilters({
  label,
  children,
  filtered,
  onClear,
}: {
  /** e.g. "Filter leads". */
  readonly label: string;
  readonly children: ReactNode;
  readonly filtered: boolean;
  readonly onClear: () => void;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className="flex flex-wrap items-end gap-3"
    >
      {children}
      {filtered ? (
        <Button variant="ghost" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A search box that reports its text after the user pauses typing (`delayMs`), or at once on
 * Enter. `value` is the search in effect (e.g. from the address bar): when it changes from
 * outside (Clear filters, Back), the box shows it; while it catches up with what the user typed,
 * the box keeps the user's text.
 */
export function SearchField({
  label,
  value,
  placeholder,
  onSearch,
  delayMs = 300,
  maxLength = 100,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onSearch: (text: string) => void;
  readonly delayMs?: number;
  readonly maxLength?: number;
}) {
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState({ value, sent: value });

  // The search in effect changed: adopt it, unless it is just what this box sent.
  if (seen.value !== value) {
    setSeen({ value, sent: value });
    if (value !== seen.sent) {
      setDraft(value);
    }
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const commit = (text: string) => {
    clearTimeout(timer.current);
    const search = text.trim();
    setSeen((current) => ({ ...current, sent: search }));
    onSearch(search);
  };

  return (
    <div className="grid w-full gap-2 sm:w-64">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id={id}
          type="search"
          className="pl-8"
          value={draft}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              commit(text);
            }, delayMs);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(event.currentTarget.value);
            }
          }}
        />
      </div>
    </div>
  );
}

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** A filter with a fixed set of values; the empty value means "all". */
export function FilterSelect({
  label,
  value,
  options,
  allLabel,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly FilterOption[];
  /** e.g. "All statuses". */
  readonly allLabel: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid w-full gap-2 sm:w-48">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
