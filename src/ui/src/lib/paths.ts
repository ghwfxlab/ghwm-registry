/**
 * Path Resolution Utility
 *
 * Resolves paths with Astro's configured BASE_URL.
 * Supports both root deployments ('/') and GitHub Pages subpath deployments ('/ghwm/').
 */

export function withBase(path: string): string {
  const metaEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : undefined;
  const procEnv = typeof process !== 'undefined' && process.env ? process.env : undefined;

  const rawBase = (metaEnv && metaEnv.BASE_URL) || (procEnv && procEnv.ASTRO_BASE) || '/';
  const cleanBase = rawBase.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  if (cleanPath === '/' || cleanPath === '') {
    return cleanBase ? `${cleanBase}/` : '/';
  }

  return `${cleanBase}${cleanPath}`;
}
