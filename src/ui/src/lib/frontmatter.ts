import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseCommentedFrontmatter } from './frontmatterParse.ts';

export { parseSimpleYaml, parseCommentedFrontmatter } from './frontmatterParse.ts';

export interface WorkflowMetadata {
  name: string;
  title: string;
  description: string;
  tags: string[];
  icon: string;
  owner: string;
  packageName: string;
  version: string;
  createdAt: string | null;
}

/**
 * Resolves the default workflows directory path in the repository.
 */
export function getDefaultWorkflowsDir(): string {
  const searchStarts = [
    process.cwd(),
  ];
  try {
    searchStarts.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // Ignore
  }

  for (const start of searchStarts) {
    let dir = start;
    while (dir && dir !== path.dirname(dir)) {
      const candidate = path.join(dir, 'workflows');
      if (
        fs.existsSync(candidate) &&
        !candidate.includes(path.sep + 'dist' + path.sep) &&
        fs.existsSync(path.join(candidate, 'super-linter'))
      ) {
        return candidate;
      }
      dir = path.dirname(dir);
    }
  }

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(currentDir, '../../../../workflows');
  } catch {
    return path.resolve(process.cwd(), 'workflows');
  }
}

/**
 * Converts a hyphen-separated workflow name into Title Case.
 * e.g. "super-linter" -> "Super Linter", "cloudrun-docker" -> "Cloudrun Docker"
 */
export function prettifyWorkflowName(name: string): string {
  if (!name) return 'N/A';
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(name.includes('-') && !name.includes('_') ? ' ' : ' ');
}

/**
 * Generates a fallback metadata object for external workflows or those lacking frontmatter.
 * Sets unknown fields to "N/A" per registry specification.
 */
export function resolveFallbackWorkflowMetadata(workflowName: string): WorkflowMetadata {
  return {
    name: workflowName,
    title: prettifyWorkflowName(workflowName),
    description: 'N/A',
    tags: ['N/A'],
    icon: 'extension',
    owner: 'N/A',
    packageName: 'N/A',
    version: 'N/A',
    createdAt: null,
  };
}

/**
 * Attempts to retrieve the creation date (first commit date) of a workflow directory or file from git history.
 */
export function getGitCreationDate(targetPath: string): string | null {
  try {
    const resolvedPath = path.isAbsolute(targetPath)
      ? targetPath
      : fs.existsSync(targetPath)
        ? path.resolve(targetPath)
        : path.resolve(getDefaultWorkflowsDir(), '..', targetPath);

    if (!fs.existsSync(resolvedPath)) {
      return null;
    }

    const cwd = fs.statSync(resolvedPath).isDirectory()
      ? resolvedPath
      : path.dirname(resolvedPath);

    const output = execFileSync('git', ['log', '--diff-filter=A', '--reverse', '--format=%aI', '--', resolvedPath], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n')[0]?.trim();
    if (output) {
      return output;
    }
    const fallback = execFileSync('git', ['log', '--reverse', '--format=%aI', resolvedPath], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n')[0]?.trim();
    return fallback || null;
  } catch {
    return null;
  }
}

/**
 * Resolves full metadata for a workflow by reading its package.json and YAML frontmatter.
 * Falls back to "N/A" for any missing fields.
 */
export function resolveLocalWorkflowMetadata(
  workflowName: string,
  workflowsDir = getDefaultWorkflowsDir()
): WorkflowMetadata {
  if (!workflowName) {
    return resolveFallbackWorkflowMetadata('unknown');
  }

  const workflowDir = path.join(workflowsDir, workflowName);
  if (!fs.existsSync(workflowDir) || !fs.statSync(workflowDir).isDirectory()) {
    return resolveFallbackWorkflowMetadata(workflowName);
  }

  // 1. Read package.json if present
  let pkgData: { name?: string; version?: string; description?: string } = {};
  const pkgPath = path.join(workflowDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      pkgData = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {
      // Ignore JSON parse errors
    }
  }

  // 2. Look for YAML workflow file to extract frontmatter
  const candidateFiles = [
    path.join(workflowDir, `${workflowName}.yaml`),
    path.join(workflowDir, `${workflowName}.yml`),
    path.join(workflowDir, 'workflow.yml'),
    path.join(workflowDir, 'workflow.yaml'),
  ];

  let frontmatter: Record<string, unknown> | null = null;
  for (const filePath of candidateFiles) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        frontmatter = parseCommentedFrontmatter(content);
        if (frontmatter) {
          break;
        }
      } catch {
        // Try next candidate
      }
    }
  }

  const title =
    typeof frontmatter?.title === 'string' && frontmatter.title.trim()
      ? frontmatter.title.trim()
      : prettifyWorkflowName(workflowName);

  const description =
    typeof frontmatter?.description === 'string' && frontmatter.description.trim()
      ? frontmatter.description.trim()
      : pkgData.description?.trim() || 'N/A';

  const tags =
    Array.isArray(frontmatter?.tags) && frontmatter.tags.length > 0
      ? frontmatter.tags.map((t) => String(t).trim()).filter(Boolean)
      : ['N/A'];

  const icon =
    typeof frontmatter?.icon === 'string' && frontmatter.icon.trim()
      ? frontmatter.icon.trim()
      : 'fact_check';

  const owner =
    typeof frontmatter?.owner === 'string' && frontmatter.owner.trim()
      ? frontmatter.owner.trim()
      : 'ghwfxlab';

  const packageName =
    typeof frontmatter?.packageName === 'string' && frontmatter.packageName.trim()
      ? frontmatter.packageName.trim()
      : pkgData.name?.trim() || `@ghwfxlab/${workflowName}`;

  const version =
    typeof frontmatter?.version === 'string' && frontmatter.version.trim()
      ? frontmatter.version.trim()
      : pkgData.version?.trim() || '1.0.0';

  const createdAt =
    (typeof frontmatter?.createdAt === 'string' && frontmatter.createdAt.trim()) ||
    getGitCreationDate(workflowDir);

  return {
    name: workflowName,
    title,
    description,
    tags,
    icon,
    owner,
    packageName,
    version,
    createdAt,
  };
}

/**
 * Lists all workflow names found in the local workflows directory.
 */
export function listLocalWorkflowNames(workflowsDir = getDefaultWorkflowsDir()): string[] {
  if (!fs.existsSync(workflowsDir)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
