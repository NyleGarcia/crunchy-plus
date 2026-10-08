/**
 * Runs in the page's MAIN world at document_start, before Crunchyroll's app boots.
 * - Captures the bearer token CR's own requests use (so the extension can call CR's API).
 * - Rewrites list payloads so the active sub/dub mode hides the other audio versions.
 * - Forwards episode metadata the player loads.
 * No extension APIs exist here; it talks to the isolated content script via window.postMessage.
 */
import { filterPayload, isFilterableUrl } from '@/lib/dub';
import { HOOK_CONFIG_KEY, HOOK_TAG, type HookConfig } from '@/lib/hook-config';

export default defineContentScript({
  matches: ['*://www.crunchyroll.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const TAG = HOOK_TAG;
    let config: HookConfig = { mode: 'sub', dubLocale: 'en-US' };
    try {
      config = { ...config, ...JSON.parse(localStorage.getItem(HOOK_CONFIG_KEY) ?? '{}') };
    } catch {}

    window.addEventListener('message', (e) => {
      if (e.source === window && e.data?.[TAG] === 'config') config = e.data.config;
    });
    const log = (...a: unknown[]) => console.info('%c[Crunchy+]', 'color:#ff7a1a', ...a);
    log('hook ready, mode =', config.mode);
    const post = (kind: string, payload: unknown) => window.postMessage({ [TAG]: kind, payload }, location.origin);

    let lastToken = '';
    const seeToken = (t: string | null | undefined) => {
      if (t && t !== lastToken) {
        lastToken = t;
        post('token', lastToken);
        log('captured CR session token');
      }
    };
    const seeAuth = (value: string | null | undefined) => seeToken(value?.match(/^Bearer\s+(.+)$/i)?.[1]);
    // CR's own token refresh: forward the new token right away, not only once the page next uses it.
    const isTokenUrl = (url: string) => /crunchyroll\.com\/auth\/v1\/token(?:[?#]|$)/.test(url);
    const seeTokenBody = (text: string) => {
      try {
        seeToken(JSON.parse(text)?.access_token);
      } catch {}
    };

    // The id the page itself puts in per-user URLs is the *active profile* (multi-profile accounts).
    let lastPathId = '';
    // Diagnostics: every CR API path the page calls (no query strings), viewable via `__crunchyplus.paths()`.
    const seenPaths = new Set<string>();
    const seePath = (url: string) => {
      try {
        const u = new URL(url, location.href);
        if (/crunchyroll\.com$/.test(u.hostname) && /^\/(content|accounts|auth|cms)\//.test(u.pathname) && seenPaths.size < 500)
          seenPaths.add(u.pathname);
      } catch {}
      const m = url.match(
        /\/content\/v2\/(?:discover\/)?([0-9a-z-]{16,})\/(?:watch-history|watchlist|custom-lists|playheads|up_next|continue_watching|history)\b/i,
      );
      if (m?.[1] && m[1] !== lastPathId) {
        lastPathId = m[1];
        post('accountPath', lastPathId);
        log('page uses per-user id', lastPathId);
      }
    };
    /** Session-token claims (payload only — ids and timestamps, not the token itself). */
    const claims = () => {
      try {
        const p = JSON.parse(atob(lastToken.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
        return Object.fromEntries(
          Object.entries(p).map(([k, v]) => [k, typeof v === 'string' && v.length > 60 ? `${v.slice(0, 12)}…` : v]),
        );
      } catch {
        return lastToken ? 'token is not a JWT' : 'no token seen yet';
      }
    };
    /**
     * Compact DOM inventory for writing selectors: class blocks (hash suffix stripped) and data-t hooks
     * with counts, plus the tag/class skeleton of one sample per card-like block. No text, no URLs.
     */
    const dom = () => {
      const strip = (c: string) => c.replace(/--[A-Za-z0-9_-]{5}$/, '');
      const blocks = new Map<string, number>();
      const hooks = new Map<string, number>();
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        for (const c of el.classList) {
          const k = strip(c);
          blocks.set(k, (blocks.get(k) ?? 0) + 1);
        }
        const t = el.dataset.t;
        if (t) hooks.set(t, (hooks.get(t) ?? 0) + 1);
      }
      const skeleton = (el: Element, depth = 0): string => {
        if (depth > 6) return '';
        const cls = [...el.classList].map(strip).join('.');
        const t = (el as HTMLElement).dataset?.t ? `[data-t=${(el as HTMLElement).dataset.t}]` : '';
        const kids = [...el.children].slice(0, 6).map((c) => skeleton(c, depth + 1)).filter(Boolean).join('');
        return `${'  '.repeat(depth)}${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${t}\n${kids}`;
      };
      const samples: string[] = [];
      const seen = new Set<string>();
      for (const el of document.querySelectorAll('[class*="card"], [class*="carousel"], [class*="hero"], [class*="player"], [class*="episode"], [class*="season"]')) {
        const key = strip([...el.classList][0] ?? '');
        if (!key || seen.has(key) || seen.size >= 12) continue;
        seen.add(key);
        samples.push(`# ${key}\n${skeleton(el)}`);
      }
      const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('\n');
      return `URL ${location.pathname.replace(/[A-Z0-9]{9,}/g, ':id')}\n\n## classes\n${top(blocks)}\n\n## data-t\n${top(hooks)}\n\n## samples\n${samples.join('\n')}`;
    };
    (window as any).__crunchyplus = {
      dom,
      paths: () => [...seenPaths].sort().join('\n'),
      claims,
      perUserId: () => lastPathId || null,
    };

    /** Analytics/telemetry endpoints Crunchyroll calls (Datadog RUM, Braze, Segment). Never video/account APIs. */
    // Datadog intake hosts are hyphenated (browser-intake-datadoghq.com, browser-intake-us5-datadoghq.com).
    const TELEMETRY = /(^|\.)([\w-]*datadoghq\.(com|eu)|datadoghq-browser-agent\.com|braze\.com|segment\.com|segment\.io)$/i;
    const isTelemetry = (url: string) => {
      try {
        return TELEMETRY.test(new URL(url, location.href).hostname);
      } catch {
        return false;
      }
    };
    const origBeacon = navigator.sendBeacon?.bind(navigator);
    if (origBeacon) {
      navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => (isTelemetry(String(url)) ? true : origBeacon(url, data));
    }

    /** Inspect a JSON body: forward episode metadata, return the filtered payload (or null = unchanged). */
    const process = (url: string, text: string): string | null => {
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        return null;
      }
      if (/\/cms\/objects\//.test(url) && json?.data?.[0]?.type === 'episode') post('episode', json.data[0]);
      if (config.mode === 'all' || !isFilterableUrl(url)) return null;
      const before = JSON.stringify(json).length;
      const out = JSON.stringify(filterPayload(json, config.mode, config.dubLocale));
      if (out.length !== before) log(`filtered ${config.mode}:`, new URL(url, location.href).pathname);
      return out;
    };

    // ---- fetch ----
    const origFetch = window.fetch;
    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const req = input instanceof Request ? input : null;
      const url = req?.url ?? String(input);
      // Crunchyroll's analytics: answer "OK" locally so nothing is sent (and no blocked-request spam).
      if (isTelemetry(url)) return new Response(null, { status: 204 });
      try {
        const h = new Headers(init?.headers ?? req?.headers);
        seeAuth(h.get('Authorization'));
      } catch {}
      seePath(url);
      const res = await origFetch.call(this, input, init);
      const href = new URL(url, location.href).href;
      if (res.ok && isTokenUrl(href)) res.clone().text().then(seeTokenBody, () => {});
      if (!/crunchyroll\.com\/content\//.test(href)) return res;
      if (!res.headers.get('content-type')?.includes('json')) return res;
      try {
        const out = process(url, await res.clone().text());
        if (out == null) return res;
        const replaced = new Response(out, { status: res.status, statusText: res.statusText, headers: res.headers });
        Object.defineProperty(replaced, 'url', { value: res.url });
        return replaced;
      } catch {
        return res;
      }
    };

    // ---- XMLHttpRequest (axios) ----
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSetHeader = XHR.setRequestHeader;
    XHR.setRequestHeader = function (name: string, value: string) {
      if (name.toLowerCase() === 'authorization') seeAuth(value);
      return origSetHeader.call(this, name, value);
    };
    XHR.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
      const href = new URL(String(url), location.href).href;
      // Analytics over XHR (Braze): point it at an empty local response instead of the network.
      if (isTelemetry(href)) return (origOpen as any).call(this, 'GET', 'data:application/json,{}', ...rest);
      seePath(href);
      if (isTokenUrl(href)) {
        this.addEventListener('load', () => {
          if (this.status !== 200) return;
          try {
            if (this.responseType === 'json') seeToken(this.response?.access_token);
            else if (!this.responseType || this.responseType === 'text') seeTokenBody(this.responseText);
          } catch {}
        });
      }
      if (/crunchyroll\.com\/content\//.test(href)) {
        // Registered before the app's own handlers (they're attached after open), so we patch first.
        this.addEventListener('readystatechange', () => {
          if (this.readyState !== 4 || (this.responseType && this.responseType !== 'text' && this.responseType !== 'json')) return;
          try {
            const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
            const out = process(href, text);
            if (out == null) return;
            const value = this.responseType === 'json' ? JSON.parse(out) : out;
            Object.defineProperty(this, 'responseText', { configurable: true, get: () => out });
            Object.defineProperty(this, 'response', { configurable: true, get: () => value });
          } catch {}
        });
      }
      return (origOpen as any).call(this, method, url, ...rest);
    };
  },
});
