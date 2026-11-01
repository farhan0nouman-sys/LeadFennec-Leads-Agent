// Browser scenarios against the real API and database (task 04C) run only when
// E2E_DATABASE_URL names a *_test database. Without it they are reported as skipped.
export const e2eDatabaseUrl = process.env['E2E_DATABASE_URL'];
export const e2eEnabled = e2eDatabaseUrl !== undefined && e2eDatabaseUrl !== '';

export const WEB_PORT = 3100;
export const API_PORT = 3101;
export const WEB_URL = `http://127.0.0.1:${String(WEB_PORT)}`;
export const API_URL = `http://127.0.0.1:${String(API_PORT)}`;

export const SKIP_REASON =
  'Set E2E_DATABASE_URL (a *_test PostgreSQL database) to run the browser scenarios against the real API.';
