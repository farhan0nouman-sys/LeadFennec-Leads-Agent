// Server-only configuration of the web app.
import 'server-only';
import { loadWebEnv } from '@/env';

let apiBaseUrl: string | undefined;

/** API_BASE_URL without a trailing slash. Never sent to the browser. */
export function apiBase(): string {
  apiBaseUrl ??= loadWebEnv(process.env).API_BASE_URL.replace(/\/+$/, '');
  return apiBaseUrl;
}
