// Pure formatting helpers shared by build-time (usage.ts) and browser code (liveApi.ts).

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
