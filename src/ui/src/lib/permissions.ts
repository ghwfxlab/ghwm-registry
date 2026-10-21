import fs from 'node:fs';
import path from 'node:path';
import { getDefaultWorkflowsDir } from './frontmatter.ts';

export type PermissionAccess = 'read' | 'write';

export interface WorkflowPermission {
  scope: string;
  access: PermissionAccess;
}

/** Plain-language explanation for each GITHUB_TOKEN scope a workflow may request. */
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  actions: 'Manage workflow runs and caches',
  attestations: 'Create build provenance attestations',
  checks: 'Create and update check runs',
  contents: 'Read repository files, or push commits, tags, and releases',
  deployments: 'Create deployments',
  'id-token': 'Request an OIDC token for keyless authentication (for example PyPI trusted publishing)',
  issues: 'Read or comment on issues',
  packages: 'Read or publish GitHub Packages',
  pages: 'Deploy to GitHub Pages',
  'pull-requests': 'Assign reviewers, post comments, and update pull request metadata',
  'security-events': 'Upload code scanning results',
  statuses: 'Set commit statuses',
};

const ACCESS_RANK: Record<string, number> = { none: 0, read: 1, write: 2 };

function stripComment(line: string): string {
  return line.replace(/\s+#.*$/, '').trimEnd();
}

/**
 * Collects every scope granted by a `permissions:` block in a workflow file, at the
 * workflow or job level. When a scope appears more than once the highest access wins,
 * so the result is the most the workflow can ever be granted. `permissions: {}` and
 * `none` entries grant nothing and are omitted.
 */
export function parseWorkflowPermissions(yamlStr: string): WorkflowPermission[] {
  const granted = new Map<string, PermissionAccess>();
  const grant = (scope: string, access: string) => {
    if ((ACCESS_RANK[access] ?? 0) === 0) return;
    const current = granted.get(scope);
    if (!current || ACCESS_RANK[access] > ACCESS_RANK[current]) {
      granted.set(scope, access as PermissionAccess);
    }
  };

  const lines = yamlStr.split(/\r?\n/).map(stripComment);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^(\s*)permissions:\s*(.*)$/);
    if (!header) continue;

    const indent = header[1].length;
    const inline = header[2].trim();
    if (inline === 'read-all' || inline === 'write-all') {
      grant('all', inline === 'read-all' ? 'read' : 'write');
      continue;
    }
    if (inline) continue;

    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      const entry = lines[j].match(/^(\s+)([A-Za-z-]+):\s*(\S+)$/);
      if (!entry || entry[1].length <= indent) break;
      grant(entry[2], entry[3]);
    }
  }

  return [...granted.entries()]
    .map(([scope, access]) => ({ scope, access }))
    .sort((a, b) => a.scope.localeCompare(b.scope));
}

/**
 * Reads the permissions requested by a registry workflow's packaged workflow file.
 * Returns null when the workflow is not available locally.
 */
export function resolveLocalWorkflowPermissions(
  workflowName: string,
  workflowsDir = getDefaultWorkflowsDir()
): WorkflowPermission[] | null {
  const dir = path.join(workflowsDir, workflowName);
  for (const ext of ['yaml', 'yml']) {
    const file = path.join(dir, `${workflowName}.${ext}`);
    if (fs.existsSync(file)) {
      return parseWorkflowPermissions(fs.readFileSync(file, 'utf-8'));
    }
  }
  return null;
}
