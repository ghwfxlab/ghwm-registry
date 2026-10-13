// Browser-safe reads of the Worker API. No node: imports.
// The Worker keeps D1 current with GitHub, so every call here is a plain D1 read;
// opening a workflow also nudges the Worker to refresh that workflow's metadata.
// Every failure resolves to null so pages keep their build-time values.
import { formatLastInstalled } from './format.ts';

export interface LiveWorkflowDetails {
  workflow_name: string;
  title: string | null;
  description: string | null;
  tags: string[];
  version: string | null;
  installs: number;
  updates: number;
  metadata_refreshed_at: string | null;
}

export interface LiveCatalogRow {
  name: string;
  title?: string;
  description?: string;
  version?: string;
  tags?: string[];
  icon?: string;
  owner?: string;
  installs: number;
  updates: number;
  total: number;
  createdAt: string | null;
  addedFormatted: string;
  lastInstalledAt: string | null;
  lastActiveFormatted: string;
}

export interface LiveOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  /** Skip the sessionStorage cache (used for the follow-up read after a background refresh). */
  fresh?: boolean;
}

const CACHE_PREFIX = 'ghwm-live:';
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_TTL_MS = 60 * 1000;

function getStorage(opts: LiveOptions): LiveOptions['storage'] {
  if (opts.storage !== undefined) return opts.storage;
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function readCache<T>(key: string, opts: LiveOptions): T | null {
  if (opts.fresh) return null;
  try {
    const raw = getStorage(opts)?.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw) as { at: number; value: T };
    return (opts.now ?? Date.now)() - at < (opts.ttlMs ?? DEFAULT_TTL_MS) ? value : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown, opts: LiveOptions): void {
  try {
    getStorage(opts)?.setItem(CACHE_PREFIX + key, JSON.stringify({ at: (opts.now ?? Date.now)(), value }));
  } catch {
    // Best effort only.
  }
}

async function getJson(url: string, opts: LiveOptions): Promise<unknown> {
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const present = (v: unknown): string | undefined => (typeof v === 'string' && v && v !== 'N/A' ? v : undefined);

/** GET {endpoint}/workflows/:name. Opening a workflow also lets the Worker refresh its metadata. */
export async function fetchWorkflowDetailsLive(
  endpoint: string,
  name: string,
  opts: LiveOptions = {},
): Promise<LiveWorkflowDetails | null> {
  const base = endpoint.trim().replace(/\/+$/, '');
  if (!base || !name) return null;
  const cacheKey = `workflow:${name}`;
  const cached = readCache<LiveWorkflowDetails>(cacheKey, opts);
  if (cached) return cached;

  const data = (await getJson(`${base}/workflows/${encodeURIComponent(name)}`, opts)) as Record<string, unknown> | null;
  if (!data || typeof data.workflow_name !== 'string') return null;
  const result: LiveWorkflowDetails = {
    workflow_name: data.workflow_name,
    title: present(data.title) ?? null,
    description: present(data.description) ?? null,
    tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string' && t !== 'N/A') : [],
    version: present(data.version) ?? null,
    installs: Number(data.installs) || 0,
    updates: Number(data.updates) || 0,
    metadata_refreshed_at: typeof data.metadata_refreshed_at === 'string' ? data.metadata_refreshed_at : null,
  };
  writeCache(cacheKey, result, opts);
  return result;
}

/** GET {endpoint}/catalog, normalized to registry table rows. A plain D1 read (no GitHub calls). */
export async function fetchCatalogLive(endpoint: string, opts: LiveOptions = {}): Promise<LiveCatalogRow[] | null> {
  const base = endpoint.trim().replace(/\/+$/, '');
  if (!base) return null;
  const cached = readCache<LiveCatalogRow[]>('catalog', opts);
  if (cached) return cached;

  const data = (await getJson(`${base}/catalog`, opts)) as { workflows?: unknown } | null;
  if (!data || !Array.isArray(data.workflows)) return null;

  const rows: LiveCatalogRow[] = [];
  for (const raw of data.workflows) {
    const w = raw as Record<string, unknown> | null;
    if (!w || typeof w.workflow_name !== 'string' || !w.workflow_name) continue;
    const tags = Array.isArray(w.tags) ? w.tags.filter((t): t is string => typeof t === 'string' && t !== 'N/A') : [];
    const createdAt = present(w.created_at) ?? null;
    const lastInstalledAt = present(w.last_installed_at) ?? null;
    rows.push({
      name: w.workflow_name,
      title: present(w.title),
      description: present(w.description),
      version: present(w.version),
      tags: tags.length > 0 ? tags : undefined,
      icon: present(w.icon),
      owner: present(w.owner),
      installs: Number(w.installs) || 0,
      updates: Number(w.updates) || 0,
      total: Number(w.total) || 0,
      createdAt,
      addedFormatted: formatLastInstalled(createdAt) ?? 'Unknown',
      lastInstalledAt,
      lastActiveFormatted: formatLastInstalled(lastInstalledAt) ?? 'None recorded',
    });
  }
  writeCache('catalog', rows, opts);
  return rows;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago"; null for missing or invalid input. */
export function formatRelativeTime(iso: string | null, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const seconds = Math.max(0, Math.round((nowMs - t) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
