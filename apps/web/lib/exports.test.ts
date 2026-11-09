import { describe, expect, it } from 'vitest';
import { maxBodyBytes } from './api-proxy';
import { exportDownloadHref, exportFilters } from './exports';

// Lead exports and import uploads in the web app (task 11C).
describe('lead exports', () => {
  it('downloads through the /api proxy, with ids only in the address', () => {
    expect(
      exportDownloadHref(
        '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10',
        '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e11',
      ),
    ).toBe(
      '/api/workspaces/0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10/exports/0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e11/download',
    );
  });

  it('exports the list’s search without its page', () => {
    expect(
      exportFilters({ q: 'ac', verification: 'verified', sort: 'name' }),
    ).toEqual({
      q: 'ac',
      verification: 'verified',
      sort: 'name',
      order: 'asc',
    });
    // A one-letter search isn't a search yet (the list ignores it too).
    expect(
      exportFilters({ q: 'a', verification: '', sort: 'created' }),
    ).toEqual({ sort: 'created', order: 'desc' });
  });

  it('lets only CSV imports carry a file through the proxy', () => {
    const ws = '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10';
    expect(maxBodyBytes(`/workspaces/${ws}/imports/csv`)).toBe(1024 * 1024);
    expect(maxBodyBytes(`/workspaces/${ws}/imports/contacts`)).toBe(
      1024 * 1024,
    );
    expect(maxBodyBytes(`/workspaces/${ws}/imports/discovery`)).toBe(64 * 1024);
    expect(maxBodyBytes(`/workspaces/${ws}/leads`)).toBe(64 * 1024);
    expect(maxBodyBytes(`/workspaces/${ws}/imports/csv/x`)).toBe(64 * 1024);
  });
});
