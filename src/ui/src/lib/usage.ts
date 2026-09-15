/**
 * Workflow Usage Service
 *
 * Provides utilities for fetching workflow telemetry and installation statistics
 * from the Cloudflare Worker deployment API (e.g. https://ghwm-deployment-tst.ghwfxlab.workers.dev).
 * Workflow metadata is dynamically resolved from workflow frontmatter and package files.
 */

import {
  resolveLocalWorkflowMetadata,
  listLocalWorkflowNames,
  type WorkflowMetadata,
} from './frontmatter.ts';

export interface WorkflowStat {
  workflow_name: string;
  installs: number;
  updates: number;
  total: number;
  last_installed_at: string | null;
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  icon?: string | null;
  owner?: string | null;
  version?: string | null;
  source_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface RegistryStatsResponse {
  source: string | null;
  total_installations: number;
  workflows: WorkflowStat[];
}

export interface CatalogResponse {
  total_workflows: number;
  total_installations: number;
  workflows: WorkflowStat[];
}

export interface WorkflowItem {
  name: string;
  packageName: string;
  version: string;
  title: string;
  description: string;
  tags: string[];
  icon: string;
  installs: number;
  updates: number;
  total: number;
  lastInstalledAt: string | null;
  owner?: string;
  createdAt?: string | null;
  sourceUrl?: string | null;
}

export interface TrendingWorkflowsResult {
  workflows: WorkflowItem[];
  totalInstallations: number;
  isConnected: boolean;
  apiEndpoint: string | null;
}

export const DEFAULT_PROD_API_URL = 'https://ghwm-deployment-prd.ghwfxlab.workers.dev';
export const DEFAULT_TEST_API_URL = 'https://ghwm-deployment-tst.ghwfxlab.workers.dev';

export const OFFICIAL_PROVIDERS = ['ghwfxlab'] as const;
export type OfficialProvider = typeof OFFICIAL_PROVIDERS[number];

/**
 * Resolves the configured API endpoint from environment variables.
 * Checks Astro's import.meta.env and Node's process.env.
 */
export function getApiEndpoint(): string {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : undefined;
  const procEnv = typeof process !== 'undefined' && process.env ? process.env : undefined;

  const rawUrl =
    (metaEnv && (metaEnv.PUBLIC_API_URL || metaEnv.GHWM_API_URL)) ||
    (procEnv && (procEnv.PUBLIC_API_URL || procEnv.GHWM_API_URL || procEnv.API_URL)) ||
    '';

  return String(rawUrl).trim().replace(/\/+$/, '');
}

/**
 * Formats an ISO date string into a user-readable date (e.g. "Sep 8, 2026").
 */
export function formatLastInstalled(isoString: string | null): string | null {
  if (!isoString) return null;
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return null;
  }
}

/**
 * Fetches all registered workflows from the canonical catalog endpoint.
 * Edge-cached and returns all workflows including those with 0 installs.
 *
 * @param endpoint Base URL of the API (defaults to resolved endpoint)
 * @param timeoutMs Request timeout in milliseconds (default: 4000ms)
 * @returns Catalog response or null if the request failed
 */
export async function fetchCatalog(
  endpoint?: string,
  timeoutMs = 4000
): Promise<CatalogResponse | null> {
  const base = (endpoint ?? getApiEndpoint()).trim().replace(/\/+$/, '');
  if (!base) {
    return null;
  }

  const url = `${base}/catalog`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[usage-api] Warning: Received status ${res.status} from ${url}`);
      return null;
    }

    const data = (await res.json()) as CatalogResponse;
    if (typeof data !== 'object' || data === null || !Array.isArray(data.workflows)) {
      console.warn(`[usage-api] Warning: Malformed payload from ${url}`);
      return null;
    }

    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[usage-api] Warning: Could not fetch catalog from ${url}: ${message}`);
    return null;
  }
}

/**
 * Fetches registry-wide statistics from the target API endpoint.
 *
 * @param endpoint Base URL of the API (defaults to resolved endpoint)
 * @param timeoutMs Request timeout in milliseconds (default: 4000ms)
 * @returns Registry stats or null if the request failed
 */
export async function fetchUsageStats(
  endpoint?: string,
  timeoutMs = 4000
): Promise<RegistryStatsResponse | null> {
  const base = (endpoint ?? getApiEndpoint()).trim().replace(/\/+$/, '');
  if (!base) {
    return null;
  }

  const url = `${base}/stats`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[usage-api] Warning: Received status ${res.status} from ${url}`);
      return null;
    }

    const data = (await res.json()) as RegistryStatsResponse;
    if (typeof data !== 'object' || data === null || !Array.isArray(data.workflows)) {
      console.warn(`[usage-api] Warning: Malformed payload from ${url}`);
      return null;
    }

    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[usage-api] Warning: Could not fetch stats from ${url}: ${message}`);
    return null;
  }
}

/**
 * Fetches statistics for a specific workflow from the target API endpoint.
 */
export async function fetchWorkflowStats(
  workflowName: string,
  endpoint?: string,
  timeoutMs = 4000
): Promise<WorkflowStat | null> {
  const base = (endpoint ?? getApiEndpoint()).trim().replace(/\/+$/, '');
  if (!base || !workflowName) {
    return null;
  }

  const url = `${base}/workflows/${encodeURIComponent(workflowName)}/stats`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as WorkflowStat;
    return data;
  } catch {
    return null;
  }
}

/**
 * Fetches detailed metadata and statistics for a specific workflow from the API.
 * First queries `/workflows/:name` (which returns metadata + metrics).
 * If that fails or returns non-200, falls back to `/workflows/:name/stats`.
 */
export async function fetchWorkflowDetails(
  workflowName: string,
  endpoint?: string,
  timeoutMs = 4000
): Promise<WorkflowStat | null> {
  const base = (endpoint ?? getApiEndpoint()).trim().replace(/\/+$/, '');
  if (!base || !workflowName) {
    return null;
  }

  const detailUrl = `${base}/workflows/${encodeURIComponent(workflowName)}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(detailUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as WorkflowStat;
      if (typeof data === 'object' && data !== null && (data.workflow_name || data.total !== undefined)) {
        return data;
      }
    }
  } catch {
    // Fall back to stats endpoint below
  }

  return fetchWorkflowStats(workflowName, base, timeoutMs);
}

/**
 * Synchronizes verified workflow metadata in bulk to the D1 catalog via POST /v1/catalog/sync.
 * Requires bearer authentication token.
 *
 * @param endpoint Base URL of the API
 * @param authToken Worker authentication token (Bearer token)
 * @param workflows Array of workflow metadata objects to persist
 * @param timeoutMs Request timeout in milliseconds (default: 8000ms)
 * @returns Sync result or null if the request failed
 */
export async function syncWorkflowCatalog(
  endpoint: string,
  authToken: string,
  workflows: Array<Record<string, unknown>>,
  timeoutMs = 8000
): Promise<{ status: string; count: number } | null> {
  const base = endpoint.trim().replace(/\/+$/, '');
  if (!base || !authToken) {
    return null;
  }

  const url = `${base}/catalog/sync`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken.trim()}`,
      },
      body: JSON.stringify({ workflows }),
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[usage-api] Warning: Received status ${res.status} from ${url}`);
      return null;
    }

    const data = (await res.json()) as { status: string; count: number };
    return data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[usage-api] Warning: Could not sync catalog to ${url}: ${message}`);
    return null;
  }
}

/**
 * Discovers workflows dynamically from the telemetry API and resolves their metadata.
 * Prefers the dedicated GET /catalog endpoint over /stats, and prefers API metadata
 * fields over local fallback values. If the API is offline or returns an empty list,
 * falls back to scanning local workflows with 0 installations recorded.
 *
 * @param customEndpoint Optional override endpoint (e.g. for testing)
 */
export async function getRegistryWorkflows(customEndpoint?: string): Promise<{
  workflows: WorkflowItem[];
  totalInstallations: number;
  isConnected: boolean;
  apiEndpoint: string | null;
}> {
  const endpoint = customEndpoint !== undefined ? customEndpoint.trim().replace(/\/+$/, '') : getApiEndpoint();

  let workflowsList: WorkflowStat[] | null = null;
  let totalInstallations = 0;
  let isConnected = false;

  if (endpoint) {
    const catalog = await fetchCatalog(endpoint);
    if (catalog !== null) {
      workflowsList = catalog.workflows;
      totalInstallations = catalog.total_installations ?? 0;
      isConnected = true;
    } else {
      const stats = await fetchUsageStats(endpoint);
      if (stats !== null) {
        workflowsList = stats.workflows;
        totalInstallations = stats.total_installations ?? 0;
        isConnected = true;
      }
    }
  }

  const workflows: WorkflowItem[] = [];

  if (workflowsList && workflowsList.length > 0) {
    for (const stat of workflowsList) {
      if (!stat || !stat.workflow_name) continue;
      const meta = resolveLocalWorkflowMetadata(stat.workflow_name);

      const hasValidTags =
        Array.isArray(stat.tags) &&
        stat.tags.length > 0 &&
        !(stat.tags.length === 1 && stat.tags[0] === 'N/A');

      workflows.push({
        name: stat.workflow_name,
        packageName: meta.packageName,
        version: stat.version && stat.version !== 'N/A' ? stat.version : meta.version,
        title: stat.title && stat.title !== 'N/A' ? stat.title : meta.title,
        description: stat.description && stat.description !== 'N/A' ? stat.description : meta.description,
        tags: hasValidTags ? (stat.tags as string[]) : meta.tags,
        icon: stat.icon && stat.icon !== 'N/A' ? stat.icon : meta.icon,
        owner: stat.owner && stat.owner !== 'N/A' ? stat.owner : meta.owner,
        createdAt: stat.created_at && stat.created_at !== 'N/A' ? stat.created_at : meta.createdAt,
        sourceUrl: stat.source_url && stat.source_url !== 'N/A' ? stat.source_url : null,
        installs: Number(stat.installs) || 0,
        updates: Number(stat.updates) || 0,
        total: Number(stat.total) || 0,
        lastInstalledAt: stat.last_installed_at ?? null,
      });
    }
  } else {
    // Offline or empty API fallback: scan local repository workflow definitions
    const localNames = listLocalWorkflowNames();
    for (const name of localNames) {
      const meta = resolveLocalWorkflowMetadata(name);
      workflows.push({
        ...meta,
        installs: 0,
        updates: 0,
        total: 0,
        lastInstalledAt: null,
      });
    }
  }

  return {
    workflows,
    totalInstallations,
    isConnected,
    apiEndpoint: isConnected ? endpoint : null,
  };
}

/**
 * Retrieves details and stats for a single workflow by name.
 * Prefers API-provided metadata fields over fallback values.
 */
export async function getWorkflowDetails(
  name: string,
  customEndpoint?: string
): Promise<WorkflowItem | null> {
  if (!name) {
    return null;
  }

  const endpoint = customEndpoint !== undefined ? customEndpoint.trim().replace(/\/+$/, '') : getApiEndpoint();
  const meta = resolveLocalWorkflowMetadata(name);
  const stat = endpoint ? await fetchWorkflowDetails(name, endpoint) : null;

  const hasValidTags =
    Array.isArray(stat?.tags) &&
    (stat?.tags.length ?? 0) > 0 &&
    !(stat?.tags.length === 1 && stat?.tags[0] === 'N/A');

  return {
    ...meta,
    name: (stat && stat.workflow_name) || meta.name,
    title: stat?.title && stat.title !== 'N/A' ? stat.title : meta.title,
    description: stat?.description && stat.description !== 'N/A' ? stat.description : meta.description,
    tags: hasValidTags ? (stat?.tags as string[]) : meta.tags,
    icon: stat?.icon && stat.icon !== 'N/A' ? stat.icon : meta.icon,
    owner: stat?.owner && stat.owner !== 'N/A' ? stat.owner : meta.owner,
    version: stat?.version && stat.version !== 'N/A' ? stat.version : meta.version,
    createdAt: stat?.created_at && stat.created_at !== 'N/A' ? stat.created_at : meta.createdAt,
    sourceUrl: stat?.source_url && stat.source_url !== 'N/A' ? stat.source_url : null,
    installs: stat ? Number(stat.installs) || 0 : 0,
    updates: stat ? Number(stat.updates) || 0 : 0,
    total: stat ? Number(stat.total) || 0 : 0,
    lastInstalledAt: stat ? stat.last_installed_at : null,
  };
}

/**
 * Builds the list of trending workflows, dynamically discovered from API telemetry
 * and frontmatter, sorted by usage (highest installs first).
 *
 * @param customEndpoint Optional override endpoint (e.g. for testing)
 */
export async function getTrendingWorkflows(customEndpoint?: string): Promise<TrendingWorkflowsResult> {
  const { workflows, totalInstallations, isConnected, apiEndpoint } = await getRegistryWorkflows(customEndpoint);

  // Sort workflows: higher usage (installs) first, then name ascending
  workflows.sort((a, b) => {
    if (b.installs !== a.installs) {
      return b.installs - a.installs;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    workflows,
    totalInstallations,
    isConnected,
    apiEndpoint,
  };
}

/**
 * Checks whether an owner or provider is recognized as an official workflow provider.
 * Returns false if owner is "N/A" or unrecognized.
 */
export function isOfficialProvider(owner: string | undefined | null): boolean {
  if (!owner || owner === 'N/A') return false;
  return (OFFICIAL_PROVIDERS as readonly string[]).includes(owner);
}

/**
 * Retrieves only workflows published by recognized official providers.
 *
 * @param customEndpoint Optional override endpoint (e.g. for testing)
 * @param provider Optional specific official provider to filter by (defaults to 'ghwfxlab')
 */
export async function getOfficialWorkflows(
  customEndpoint?: string,
  provider: OfficialProvider = 'ghwfxlab'
): Promise<TrendingWorkflowsResult> {
  const result = await getTrendingWorkflows(customEndpoint);
  const filtered = result.workflows.filter((w) => w.owner === provider);
  return {
    ...result,
    workflows: filtered,
  };
}

/**
 * Retrieves the latest added workflows (up to limit), ordered newest first.
 *
 * @param customEndpoint Optional override endpoint (e.g. for testing)
 * @param limit Maximum number of workflows to return (default: 5)
 */
export async function getNewArrivals(
  customEndpoint?: string,
  limit = 5
): Promise<WorkflowItem[]> {
  const result = await getTrendingWorkflows(customEndpoint);
  const sorted = [...result.workflows].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : (a.lastInstalledAt ? new Date(a.lastInstalledAt).getTime() : 0);
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : (b.lastInstalledAt ? new Date(b.lastInstalledAt).getTime() : 0);
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return a.name.localeCompare(b.name);
  });
  return sorted.slice(0, limit);
}

/**
 * Returns all unique tags present across workflows.
 * Excludes fallback "N/A" tag.
 */
export function getAllWorkflowTags(workflows?: WorkflowItem[]): string[] {
  const tagSet = new Set<string>();
  const items =
    workflows ??
    listLocalWorkflowNames().map((name) => resolveLocalWorkflowMetadata(name));

  for (const workflow of items) {
    if (Array.isArray(workflow.tags)) {
      for (const tag of workflow.tags) {
        if (tag && tag !== 'N/A') {
          tagSet.add(tag);
        }
      }
    }
  }
  return Array.from(tagSet).sort();
}
