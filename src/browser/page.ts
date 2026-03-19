/**
 * Page abstraction — implements IPage by sending commands to the daemon.
 *
 * All browser operations are ultimately 'exec' (JS evaluation via CDP)
 * plus a few native Chrome Extension APIs (tabs, cookies, navigate).
 *
 * IMPORTANT: After goto(), we remember the tabId returned by the navigate
 * action and pass it to all subsequent commands. This avoids the issue
 * where resolveTabId() in the extension picks a chrome:// or
 * chrome-extension:// tab that can't be debugged.
 */

import { formatSnapshot } from '../snapshotFormatter.js';
import type { IPage } from '../types.js';
import { sendCommand } from './daemon-client.js';

/**
 * Page — implements IPage by talking to the daemon via HTTP.
 */
export class Page implements IPage {
  /** Active tab ID, set after navigate and used in all subsequent commands */
  private _tabId: number | undefined;

  /** Helper: spread tabId into command params if we have one */
  private _tabOpt(): { tabId: number } | Record<string, never> {
    return this._tabId !== undefined ? { tabId: this._tabId } : {};
  }

  async goto(url: string): Promise<void> {
    const result = await sendCommand('navigate', {
      url,
      ...this._tabOpt(),
    }) as { tabId?: number };
    // Remember the tabId for subsequent exec calls
    if (result?.tabId) {
      this._tabId = result.tabId;
    }
  }

  async evaluate(js: string): Promise<any> {
    const code = wrapForEval(js);
    return sendCommand('exec', { code, ...this._tabOpt() });
  }

  async snapshot(opts: { interactive?: boolean; compact?: boolean; maxDepth?: number; raw?: boolean } = {}): Promise<any> {
    const maxDepth = Math.max(1, Math.min(Number(opts.maxDepth) || 50, 200));
    const code = `
      (async () => {
        function buildTree(node, depth) {
          if (depth > ${maxDepth}) return '';
          const role = node.getAttribute?.('role') || node.tagName?.toLowerCase() || 'generic';
          const name = node.getAttribute?.('aria-label') || node.getAttribute?.('alt') || node.textContent?.trim().slice(0, 80) || '';
          const isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(node.tagName?.toLowerCase()) || node.getAttribute?.('tabindex') != null;

          ${opts.interactive ? 'if (!isInteractive && !node.children?.length) return "";' : ''}

          let indent = '  '.repeat(depth);
          let line = indent + role;
          if (name) line += ' "' + name.replace(/"/g, '\\\\"') + '"';
          if (node.tagName?.toLowerCase() === 'a' && node.href) line += ' [' + node.href + ']';
          if (node.tagName?.toLowerCase() === 'input') line += ' [' + (node.type || 'text') + ']';

          let result = line + '\\n';
          if (node.children) {
            for (const child of node.children) {
              result += buildTree(child, depth + 1);
            }
          }
          return result;
        }
        return buildTree(document.body, 0);
      })()
    `;
    const raw = await sendCommand('exec', { code, ...this._tabOpt() });
    if (opts.raw) return raw;
    if (typeof raw === 'string') return formatSnapshot(raw, opts);
    return raw;
  }

  async click(ref: string): Promise<void> {
    const safeRef = JSON.stringify(ref);
    const code = `
      (() => {
        const ref = ${safeRef};
        const el = document.querySelector('[data-ref="' + ref + '"]')
          || document.querySelectorAll('a, button, input, [role="button"], [tabindex]')[parseInt(ref, 10) || 0];
        if (!el) throw new Error('Element not found: ' + ref);
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.click();
        return 'clicked';
      })()
    `;
    await sendCommand('exec', { code, ...this._tabOpt() });
  }

  async typeText(ref: string, text: string): Promise<void> {
    const safeRef = JSON.stringify(ref);
    const safeText = JSON.stringify(text);
    const code = `
      (() => {
        const ref = ${safeRef};
        const el = document.querySelector('[data-ref="' + ref + '"]')
          || document.querySelectorAll('input, textarea, [contenteditable]')[parseInt(ref, 10) || 0];
        if (!el) throw new Error('Element not found: ' + ref);
        el.focus();
        el.value = ${safeText};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'typed';
      })()
    `;
    await sendCommand('exec', { code, ...this._tabOpt() });
  }

  async pressKey(key: string): Promise<void> {
    const code = `
      (() => {
        const el = document.activeElement || document.body;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }));
        return 'pressed';
      })()
    `;
    await sendCommand('exec', { code, ...this._tabOpt() });
  }

  async wait(options: number | { text?: string; time?: number; timeout?: number }): Promise<void> {
    if (typeof options === 'number') {
      await new Promise(resolve => setTimeout(resolve, options * 1000));
      return;
    }
    if (options.time) {
      await new Promise(resolve => setTimeout(resolve, options.time! * 1000));
      return;
    }
    if (options.text) {
      const timeout = (options.timeout ?? 30) * 1000;
      const code = `
        new Promise((resolve, reject) => {
          const deadline = Date.now() + ${timeout};
          const check = () => {
            if (document.body.innerText.includes(${JSON.stringify(options.text)})) return resolve('found');
            if (Date.now() > deadline) return reject(new Error('Text not found: ' + ${JSON.stringify(options.text)}));
            setTimeout(check, 200);
          };
          check();
        })
      `;
      await sendCommand('exec', { code, ...this._tabOpt() });
    }
  }

  async tabs(): Promise<any> {
    return sendCommand('tabs', { op: 'list' });
  }

  async closeTab(index?: number): Promise<void> {
    await sendCommand('tabs', { op: 'close', ...(index !== undefined ? { index } : {}) });
  }

  async newTab(): Promise<void> {
    await sendCommand('tabs', { op: 'new' });
  }

  async selectTab(index: number): Promise<void> {
    await sendCommand('tabs', { op: 'select', index });
  }

  async networkRequests(includeStatic: boolean = false): Promise<any> {
    const code = `
      (() => {
        const entries = performance.getEntriesByType('resource');
        return entries
          ${includeStatic ? '' : '.filter(e => !["img", "font", "css", "script"].some(t => e.initiatorType === t))'}
          .map(e => ({
            url: e.name,
            type: e.initiatorType,
            duration: Math.round(e.duration),
            size: e.transferSize || 0,
          }));
      })()
    `;
    return sendCommand('exec', { code, ...this._tabOpt() });
  }

  /**
   * Console messages are not available in lightweight daemon mode.
   * Would require CDP Runtime.consoleAPICalled event listener.
   * @returns Always returns empty array.
   */
  async consoleMessages(_level: string = 'info'): Promise<any> {
    return [];
  }

  /**
   * Capture a screenshot via CDP Page.captureScreenshot.
   * @param options.format - 'png' (default) or 'jpeg'
   * @param options.quality - JPEG quality 0-100
   * @param options.fullPage - capture full scrollable page
   * @param options.path - save to file path (returns base64 if omitted)
   */
  async screenshot(options: {
    format?: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
    path?: string;
  } = {}): Promise<string> {
    const base64 = await sendCommand('screenshot', {
      format: options.format,
      quality: options.quality,
      fullPage: options.fullPage,
      ...this._tabOpt(),
    }) as string;

    if (options.path) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = path.dirname(options.path);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(options.path, Buffer.from(base64, 'base64'));
    }

    return base64;
  }

  async scroll(direction: string = 'down', amount: number = 500): Promise<void> {
    const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    await sendCommand('exec', {
      code: `window.scrollBy(${dx}, ${dy})`,
      ...this._tabOpt(),
    });
  }

  async autoScroll(options: { times?: number; delayMs?: number } = {}): Promise<void> {
    const times = options.times ?? 3;
    const delayMs = options.delayMs ?? 2000;
    const code = `
      (async () => {
        for (let i = 0; i < ${times}; i++) {
          const lastHeight = document.body.scrollHeight;
          window.scrollTo(0, lastHeight);
          await new Promise(resolve => {
            let timeoutId;
            const observer = new MutationObserver(() => {
              if (document.body.scrollHeight > lastHeight) {
                clearTimeout(timeoutId);
                observer.disconnect();
                setTimeout(resolve, 100);
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            timeoutId = setTimeout(() => { observer.disconnect(); resolve(null); }, ${delayMs});
          });
        }
      })()
    `;
    await sendCommand('exec', { code, ...this._tabOpt() });
  }

  async installInterceptor(pattern: string): Promise<void> {
    const { generateInterceptorJs } = await import('../interceptor.js');
    // Must use evaluate() so wrapForEval() converts the arrow function into an IIFE;
    // sendCommand('exec') sends the code as-is, and CDP never executes a bare arrow.
    await this.evaluate(generateInterceptorJs(JSON.stringify(pattern), {
      arrayName: '__opencli_xhr',
      patchGuard: '__opencli_interceptor_patched',
    }));
  }

  async getInterceptedRequests(): Promise<any[]> {
    const { generateReadInterceptedJs } = await import('../interceptor.js');
    // Same as installInterceptor: must go through evaluate() for IIFE wrapping
    const result = await this.evaluate(generateReadInterceptedJs('__opencli_xhr'));
    return (result as any[]) || [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Wrap JS code for CDP Runtime.evaluate:
 * - Already an IIFE `(...)()` → send as-is
 * - Arrow/function literal → wrap as IIFE `(code)()`
 * - `new Promise(...)` or raw expression → send as-is (expression)
 */
function wrapForEval(js: string): string {
  const code = js.trim();
  if (!code) return 'undefined';

  // Already an IIFE: `(async () => { ... })()` or `(function() {...})()`
  if (/^\([\s\S]*\)\s*\(.*\)\s*$/.test(code)) return code;

  // Arrow function: `() => ...` or `async () => ...`
  if (/^(async\s+)?(\([^)]*\)|[A-Za-z_]\w*)\s*=>/.test(code)) return `(${code})()`;

  // Function declaration: `function ...` or `async function ...`
  if (/^(async\s+)?function[\s(]/.test(code)) return `(${code})()`;

  // Everything else: bare expression, `new Promise(...)`, etc. → evaluate directly
  return code;
}
