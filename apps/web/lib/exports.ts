// Lead exports in the web app (task 11C, docs/decisions.md D-11C-02). Pure: no React, no fetch.
import { EXPORT_ROUTES, type LeadSearchQuery } from '@lead-fennec-ai/shared';

/**
 * The file's download link: the API route through the web origin's /api proxy. The browser sends
 * the session cookie; the address carries only the workspace and the file's ids, never a token.
 */
export const exportDownloadHref = (workspaceId: string, exportId: string) =>
  `/api${EXPORT_ROUTES.download(workspaceId, exportId)}`;

/** The list's search as an export's filters: the same query, without its page. */
export function exportFilters(view: {
  readonly q: string;
  readonly verification: string;
  readonly sort: 'created' | 'activity' | 'name' | 'company';
}): LeadSearchQuery {
  return {
    sort: view.sort,
    order: view.sort === 'name' || view.sort === 'company' ? 'asc' : 'desc',
    ...(view.q.length >= 2 ? { q: view.q } : {}),
    ...(view.verification === '' ? {} : { verification: view.verification }),
  };
}
