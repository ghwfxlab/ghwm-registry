/**
 * GitHub API Client and Utilities for GHWM
 *
 * Provides utilities to query the GitHub API for releases and tags,
 * ensuring installation commands always recommend the latest release.
 */

export const DEFAULT_GHWM_REPO = 'ghwfxlab/ghwm';
export const DEFAULT_GHWM_TAG = 'v1.4.0';

export interface FetchLatestTagOptions {
  repo?: string;
  fallbackTag?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  token?: string;
}

/**
 * Resolves an optional GitHub token from environment variables
 * to avoid rate limits during automated builds or CI runs.
 */
export function getGitHubToken(): string | undefined {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : undefined;
  const procEnv = typeof process !== 'undefined' && process.env ? process.env : undefined;

  return (
    (metaEnv && (metaEnv.GITHUB_TOKEN || metaEnv.GH_TOKEN)) ||
    (procEnv && (procEnv.GITHUB_TOKEN || procEnv.GH_TOKEN)) ||
    undefined
  );
}

/**
 * Fetches the latest release tag from GitHub API for a given repository.
 * Falls back to the latest git tag if no GitHub release exists.
 * Gracefully returns fallbackTag if the request times out, fails, or is rate-limited.
 */
export async function fetchLatestGhwmTag(options: FetchLatestTagOptions = {}): Promise<string> {
  const repo = options.repo || DEFAULT_GHWM_REPO;
  const fallback = options.fallbackTag || DEFAULT_GHWM_TAG;
  const timeoutMs = options.timeoutMs ?? 4000;
  const fetchImpl = options.fetchFn || fetch;
  const token = options.token !== undefined ? options.token : getGitHubToken();

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ghwm-registry',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  // 1. Attempt to get the latest formal release
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as { tag_name?: string };
      if (data && typeof data.tag_name === 'string' && data.tag_name.trim()) {
        return data.tag_name.trim().replace(/^@+/, '');
      }
    } else if (res.status !== 404) {
      console.warn(`[github-api] Warning: Received status ${res.status} for ${repo} releases/latest`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[github-api] Warning: Error fetching release for ${repo}: ${msg}`);
  }

  // 2. Fallback to latest tag if release not found or request failed
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetchImpl(`https://api.github.com/repos/${repo}/tags?per_page=1`, {
      signal: controller.signal,
      headers,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const tags = (await res.json()) as Array<{ name?: string }>;
      if (Array.isArray(tags) && tags.length > 0 && typeof tags[0]?.name === 'string' && tags[0].name.trim()) {
        return tags[0].name.trim().replace(/^@+/, '');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[github-api] Warning: Error fetching tags for ${repo}: ${msg}`);
  }

  return fallback;
}

/**
 * Builds the map of installation commands for the Get Started component.
 */
export function getInstallCommands(
  tag: string = DEFAULT_GHWM_TAG,
  repo: string = DEFAULT_GHWM_REPO
): Record<string, string> {
  const cleanTag = tag.trim().replace(/^@+/, '') || DEFAULT_GHWM_TAG;
  const repoUrl = `git+https://github.com/${repo}.git`;
  return {
    'uv-pinned': `uv tool install ${repoUrl}@${cleanTag}`,
    'uv': `uv tool install ${repoUrl}`,
    'pipx': `pipx install ${repoUrl}`,
    'pip': `pip install ${repoUrl}`,
  };
}
