/**
 * WeRead shared helpers: fetch wrappers and formatting.
 *
 * Two API domains:
 * - WEB_API (weread.qq.com/web/*): public, Node.js fetch
 * - API (i.weread.qq.com/*): private, browser page.evaluate with cookies
 */

import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';

const WEB_API = 'https://weread.qq.com/web';
const API = 'https://i.weread.qq.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Fetch a public WeRead web endpoint (Node.js direct fetch).
 * Used by search and ranking commands (browser: false).
 */
export async function fetchWebApi(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${WEB_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': UA },
  });
  if (!resp.ok) {
    throw new CliError('FETCH_ERROR', `HTTP ${resp.status} for ${path}`, 'WeRead API may be temporarily unavailable');
  }
  try {
    return await resp.json();
  } catch {
    throw new CliError('PARSE_ERROR', `Invalid JSON response for ${path}`, 'WeRead may have returned an HTML error page');
  }
}

/**
 * Fetch a private WeRead API endpoint via browser page.evaluate.
 * Automatically carries cookies for authenticated requests.
 */
export async function fetchWithPage(page: IPage, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const urlStr = url.toString();
  const data = await page.evaluate(`
    async () => {
      const res = await fetch(${JSON.stringify(urlStr)}, { credentials: "include" });
      if (!res.ok) return { _httpError: String(res.status) };
      try { return await res.json(); }
      catch { return { _httpError: 'JSON parse error (status ' + res.status + ')' }; }
    }
  `);
  if (data?._httpError) {
    throw new CliError('FETCH_ERROR', `HTTP ${data._httpError} for ${path}`, 'WeRead API may be temporarily unavailable');
  }
  if (data?.errcode === -2010) {
    throw new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first');
  }
  if (data?.errcode != null && data.errcode !== 0) {
    throw new CliError('API_ERROR', data.errmsg ?? `WeRead API error ${data.errcode}`);
  }
  return data;
}

/** Format a Unix timestamp (seconds) to YYYY-MM-DD in UTC+8. Returns '-' for invalid input. */
export function formatDate(ts: number | undefined | null): string {
  if (!Number.isFinite(ts) || (ts as number) <= 0) return '-';
  // WeRead timestamps are China-centric; offset to UTC+8 to avoid off-by-one near midnight
  const d = new Date((ts as number) * 1000 + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}
