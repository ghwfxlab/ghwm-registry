// Browser-safe live metadata lookup. No node: imports.
// Tries the Worker `/live` endpoint first, then falls back to raw.githubusercontent.com.
// Every failure resolves to null so callers keep their build-time values.
import { parseCommentedFrontmatter } from './frontmatterParse.ts';

export interface LiveWorkflow {
  name: string;
  version?: string;
  title?: string;
  description?: string;
  tags?: string[];
  icon?: string;
  owner?: string;
}

export interface LiveOptions {
  /** Worker base URL (PUBLIC_API_URL). Empty skips the Worker attempt. */
  endpoint?: string;
  repo?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
}

const DEFAULT_REPO = 'ghwfxlab/ghwm-registry';
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const CACHE_PREFIX = 'ghwm-live:';

function getStorage(opts: LiveOptions): LiveOptions['storage'] {
  if (opts.storage !== undefined) return opts.storage;
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function readCache<T>(key: string, opts: LiveOptions): T | null {
  try {
    const raw = getStorage(opts)?.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    const now = (opts.now ?? Date.now)();
    return now - at < (opts.ttlMs ?? DEFAULT_TTL_MS) ? value : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown, opts: LiveOptions): void {
  try {
    getStorage(opts)?.setItem(CACHE_PREFIX + key, JSON.stringify({ at: (opts.now ?? Date.now)(), value }));
  } catch {
    // Storage may be unavailable or full; caching is best-effort.
  }
}

async function getText(url: string, opts: LiveOptions, accept?: string): Promise<string | null> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { signal: controller.signal, headers: accept ? { Accept: accept } : undefined });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url: string, opts: LiveOptions): Promise<unknown> {
  const text = await getText(url, opts, 'application/json');
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function clean(item: unknown): LiveWorkflow | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name) return null;
  const str = (v: unknown) => (typeof v === 'string' && v && v !== 'N/A' ? v : undefined);
  const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string' && t !== 'N/A') : [];
  return {
    name: o.name,
    version: str(o.version),
    title: str(o.title),
    description: str(o.description),
    tags: tags.length > 0 ? tags : undefined,
    icon: str(o.icon),
    owner: str(o.owner),
  };
}

/** Fetches package.json and the frontmatter of `<name>.yaml` straight from GitHub. */
async function fetchWorkflowRaw(name: string, opts: LiveOptions): Promise<LiveWorkflow | null> {
  const base = `https://raw.githubusercontent.com/${opts.repo ?? DEFAULT_REPO}/main/workflows/${encodeURIComponent(name)}`;
  const [pkgText, yamlText] = await Promise.all([
    getText(`${base}/package.json`, opts),
    getText(`${base}/${encodeURIComponent(name)}.yaml`, opts),
  ]);
  if (pkgText === null && yamlText === null) return null;

  let pkg: Record<string, unknown> = {};
  try {
    pkg = pkgText ? (JSON.parse(pkgText) as Record<string, unknown>) : {};
  } catch {
    pkg = {};
  }
  const fm = (yamlText ? parseCommentedFrontmatter(yamlText) : null) ?? {};
  return clean({
    name,
    version: pkg.version,
    description: fm.description ?? pkg.description,
    title: fm.title,
    tags: fm.tags,
    icon: fm.icon,
    owner: fm.owner,
  });
}

export async function fetchWorkflowLive(name: string, opts: LiveOptions = {}): Promise<LiveWorkflow | null> {
  const cacheKey = `workflow:${name}`;
  const cached = readCache<LiveWorkflow>(cacheKey, opts);
  if (cached) return cached;

  let result: LiveWorkflow | null = null;
  if (opts.endpoint) {
    result = clean(await getJson(`${opts.endpoint.replace(/\/+$/, '')}/live/${encodeURIComponent(name)}`, opts));
  }
  result ??= await fetchWorkflowRaw(name, opts);
  if (result) writeCache(cacheKey, result, opts);
  return result;
}

export async function fetchRegistryLive(opts: LiveOptions = {}): Promise<LiveWorkflow[] | null> {
  const cacheKey = 'registry';
  const cached = readCache<LiveWorkflow[]>(cacheKey, opts);
  if (cached) return cached;

  let result: LiveWorkflow[] | null = null;
  if (opts.endpoint) {
    const data = (await getJson(`${opts.endpoint.replace(/\/+$/, '')}/live`, opts)) as { workflows?: unknown } | null;
    if (data && Array.isArray(data.workflows)) {
      result = data.workflows.map(clean).filter((w): w is LiveWorkflow => w !== null);
    }
  }

  if (result === null) {
    const listing = await getJson(
      `https://api.github.com/repos/${opts.repo ?? DEFAULT_REPO}/contents/workflows?ref=main`,
      opts,
    );
    if (Array.isArray(listing)) {
      const names = listing
        .filter((e): e is { name: string; type: string } => !!e && e.type === 'dir' && typeof e.name === 'string')
        .map((e) => e.name);
      const items = await Promise.all(names.map((n) => fetchWorkflowRaw(n, opts)));
      result = items.filter((w): w is LiveWorkflow => w !== null);
    }
  }

  if (result) writeCache(cacheKey, result, opts);
  return result;
}
