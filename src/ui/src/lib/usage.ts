/**
 * Workflow Usage Service
 *
 * Provides utilities for fetching workflow telemetry and installation statistics
 * from the Cloudflare Worker deployment API (e.g. https://ghwm-deployment-tst.ghwfxlab.workers.dev).
 */

export interface WorkflowStat {
  workflow_name: string;
  installs: number;
  updates: number;
  total: number;
  last_installed_at: string | null;
}

export interface RegistryStatsResponse {
  source: string | null;
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
 * Curated catalog of workflows maintained in this repository.
 */
export const CATALOG_WORKFLOWS: Omit<WorkflowItem, 'installs' | 'updates' | 'total' | 'lastInstalledAt'>[] = [
  {
    name: 'super-linter',
    packageName: '@ghwfxlab/ghwm-super-linter',
    version: '1.0.0',
    title: 'Super-Linter',
    description: 'Code linting workflow using Super-Linter and pre-commit hooks for comprehensive multi-language code quality.',
    tags: ['lint', 'actions', 'pre-commit'],
    icon: 'fact_check',
    owner: 'ghwfxlab',
    createdAt: '2026-09-01T10:00:00.000Z',
  },
  {
    name: 'auto-assign-pr',
    packageName: '@ghwfxlab/ghwm-auto-assign-pr',
    version: '1.0.0',
    title: 'Auto Assign PR',
    description: 'Automatically add pull request reviewers and assignees to streamline pull request triage and reviews.',
    tags: ['automation', 'pr', 'review'],
    icon: 'person_add',
    owner: 'ghwfxlab',
    createdAt: '2026-09-08T12:00:00.000Z',
  },
];

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
 * Retrieves details and stats for a single workflow by name.
 */
export async function getWorkflowDetails(
  name: string,
  customEndpoint?: string
): Promise<WorkflowItem | null> {
  const baseWorkflow = CATALOG_WORKFLOWS.find((w) => w.name === name);
  if (!baseWorkflow) {
    return null;
  }

  const endpoint = customEndpoint !== undefined ? customEndpoint.trim().replace(/\/+$/, '') : getApiEndpoint();
  const stat = endpoint ? await fetchWorkflowStats(name, endpoint) : null;

  return {
    ...baseWorkflow,
    installs: stat ? Number(stat.installs) || 0 : 0,
    updates: stat ? Number(stat.updates) || 0 : 0,
    total: stat ? Number(stat.total) || 0 : 0,
    lastInstalledAt: stat ? stat.last_installed_at : null,
  };
}

/**
 * Builds the list of trending workflows, merged with live usage metrics
 * when a target API endpoint is configured.
 *
 * @param customEndpoint Optional override endpoint (e.g. for testing)
 */
export async function getTrendingWorkflows(customEndpoint?: string): Promise<TrendingWorkflowsResult> {
  const endpoint = customEndpoint !== undefined ? customEndpoint.trim().replace(/\/+$/, '') : getApiEndpoint();
  const stats = endpoint ? await fetchUsageStats(endpoint) : null;

  const isConnected = stats !== null;
  const totalInstallations = stats?.total_installations ?? 0;

  // Build a lookup map from API stats
  const statsMap = new Map<string, WorkflowStat>();
  if (stats?.workflows) {
    for (const stat of stats.workflows) {
      if (stat && stat.workflow_name) {
        statsMap.set(stat.workflow_name, stat);
      }
    }
  }

  // Merge catalog workflows with live stats
  const mergedWorkflows: WorkflowItem[] = CATALOG_WORKFLOWS.map((item) => {
    const stat = statsMap.get(item.name);
    return {
      ...item,
      installs: stat ? Number(stat.installs) || 0 : 0,
      updates: stat ? Number(stat.updates) || 0 : 0,
      total: stat ? Number(stat.total) || 0 : 0,
      lastInstalledAt: stat ? stat.last_installed_at : null,
    };
  });

  // Include any extra workflows present in the API that were not in catalog
  if (stats?.workflows) {
    for (const stat of stats.workflows) {
      if (!CATALOG_WORKFLOWS.some((c) => c.name === stat.workflow_name)) {
        mergedWorkflows.push({
          name: stat.workflow_name,
          packageName: `@ghwfxlab/ghwm-${stat.workflow_name}`,
          version: '1.0.0',
          title: stat.workflow_name
            .split('-')
            .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(' '),
          description: `Managed GitHub Actions workflow for ${stat.workflow_name}.`,
          tags: ['workflow', 'github-actions'],
          icon: 'terminal',
          installs: Number(stat.installs) || 0,
          updates: Number(stat.updates) || 0,
          total: Number(stat.total) || 0,
          lastInstalledAt: stat.last_installed_at,
          owner: 'ghwfxlab',
          createdAt: stat.last_installed_at,
        });
      }
    }
  }

  // Sort workflows: higher usage (installs) first
  mergedWorkflows.sort((a, b) => {
    if (b.installs !== a.installs) {
      return b.installs - a.installs;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    workflows: mergedWorkflows,
    totalInstallations,
    isConnected,
    apiEndpoint: isConnected ? endpoint : null,
  };
}

/**
 * Checks whether an owner or provider is recognized as an official workflow provider.
 */
export function isOfficialProvider(owner: string | undefined | null): boolean {
  if (!owner) return false;
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
    return b.name.localeCompare(a.name);
  });
  return sorted.slice(0, limit);
}

/**
 * Returns all unique tags present across catalog workflows.
 */
export function getAllWorkflowTags(): string[] {
  const tagSet = new Set<string>();
  for (const workflow of CATALOG_WORKFLOWS) {
    if (Array.isArray(workflow.tags)) {
      for (const tag of workflow.tags) {
        if (tag) tagSet.add(tag);
      }
    }
  }
  return Array.from(tagSet).sort();
}


