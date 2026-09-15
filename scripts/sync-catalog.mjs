#!/usr/bin/env node

/**
 * Workflow Catalog Synchronization Script
 *
 * Scans local repository workflow definitions and syncs verified metadata
 * to the Cloudflare D1 catalog via POST /v1/catalog/sync.
 *
 * Usage:
 *   node scripts/sync-catalog.mjs [--strict] [--endpoint=<url>]
 *
 * Environment variables:
 *   WORKER_AUTH_TOKEN / AUTH_TOKEN: Bearer token for the Worker admin API
 *   PUBLIC_API_URL / GHWM_API_URL / API_URL: Target worker base URL
 */

import { listLocalWorkflowNames, resolveLocalWorkflowMetadata } from '../src/ui/src/lib/frontmatter.ts';
import { syncWorkflowCatalog, DEFAULT_PROD_API_URL } from '../src/ui/src/lib/usage.ts';

async function main() {
  const args = process.argv.slice(2);
  const isStrict = args.includes('--strict');
  const endpointArg = args.find((a) => a.startsWith('--endpoint='))?.split('=')[1];

  const endpoint = (
    endpointArg ||
    process.env.PUBLIC_API_URL ||
    process.env.GHWM_API_URL ||
    process.env.API_URL ||
    DEFAULT_PROD_API_URL
  ).trim().replace(/\/+$/, '');

  const authToken = (process.env.WORKER_AUTH_TOKEN || process.env.AUTH_TOKEN || '').trim();

  if (!authToken) {
    if (isStrict) {
      console.error('[sync-catalog] Error: WORKER_AUTH_TOKEN is required in strict mode.');
      process.exit(1);
    }
    console.log('[sync-catalog] Notice: WORKER_AUTH_TOKEN not set; skipping catalog synchronization.');
    process.exit(0);
  }

  const workflowNames = listLocalWorkflowNames();
  if (workflowNames.length === 0) {
    console.log('[sync-catalog] No local workflows found to sync.');
    process.exit(0);
  }

  const workflows = workflowNames.map((name) => {
    const meta = resolveLocalWorkflowMetadata(name);
    const owner = meta.owner && meta.owner !== 'N/A' ? meta.owner : 'ghwfxlab';
    const tags =
      Array.isArray(meta.tags) && meta.tags.length > 0 && !(meta.tags.length === 1 && meta.tags[0] === 'N/A')
        ? meta.tags
        : [];

    return {
      workflow_name: meta.name,
      title: meta.title && meta.title !== 'N/A' ? meta.title : meta.name,
      description: meta.description && meta.description !== 'N/A' ? meta.description : '',
      tags,
      icon: meta.icon && meta.icon !== 'N/A' ? meta.icon : 'fact_check',
      owner,
      version: meta.version && meta.version !== 'N/A' ? meta.version : '1.0.0',
      source_url: `https://github.com/${owner}/ghwm-registry`,
      created_at: meta.createdAt || null,
    };
  });

  console.log(`[sync-catalog] Syncing ${workflows.length} workflows to ${endpoint}/catalog/sync...`);

  const result = await syncWorkflowCatalog(endpoint, authToken, workflows);
  if (!result || result.status !== 'synced') {
    console.error(`[sync-catalog] Error: Failed to synchronize catalog to ${endpoint}`);
    process.exit(1);
  }

  console.log(`[sync-catalog] Successfully synced ${result.count ?? workflows.length} workflows to ${endpoint}`);
}

main().catch((err) => {
  console.error('[sync-catalog] Unexpected error:', err);
  process.exit(1);
});
