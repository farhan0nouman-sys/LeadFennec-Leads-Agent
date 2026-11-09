'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/select';

/**
 * Previous / next pages of a cursor-paginated list (the API pages by cursor, never by offset),
 * with the page number and an optional page-size choice (task 05B).
 */
export function CursorPagination({
  label,
  page,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  pageSize,
  pageSizes,
  onPageSizeChange,
  disabled = false,
}: {
  /** What is paged, e.g. "Members": the navigation is named "Members pages". */
  readonly label: string;
  /** 1-based. */
  readonly page: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly pageSize?: number;
  readonly pageSizes?: readonly number[];
  readonly onPageSizeChange?: (size: number) => void;
  readonly disabled?: boolean;
}) {
  const sizeId = useId();
  if (!hasPrevious && !hasNext && onPageSizeChange === undefined) {
    return null;
  }
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p aria-live="polite" className="text-muted-foreground">
        Page {page}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange === undefined || pageSize === undefined ? null : (
          <div className="flex items-center gap-2">
            <label htmlFor={sizeId} className="text-muted-foreground">
              Rows per page
            </label>
            <NativeSelect
              id={sizeId}
              className="h-8 w-20"
              value={String(pageSize)}
              disabled={disabled}
              onChange={(event) => {
                onPageSizeChange(Number(event.target.value));
              }}
            >
              {(pageSizes ?? [pageSize]).map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !hasPrevious}
            onClick={onPrevious}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || !hasNext}
            onClick={onNext}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
