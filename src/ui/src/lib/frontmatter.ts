import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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
 * Parses scalar values (strings, booleans, numbers, inline lists) from YAML.
 */
function parseScalar(val: string): unknown {
  const trimmed = val.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inside = trimmed.slice(1, -1).trim();
    if (!inside) return [];
    return inside.split(',').map((s) => parseScalar(s.trim()));
  }
  return trimmed;
}

/**
 * Lightweight, zero-dependency parser for YAML key-values and arrays in frontmatter blocks.
 */
export function parseSimpleYaml(yamlStr: string): Record<string, unknown> | null {
  const lines = yamlStr.split(/\r?\n/);
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArray: unknown[] | null = null;

  for (const rawLine of lines) {
    let line = rawLine;
    const commentMatch = rawLine.match(/\s+#.*$/);
    if (commentMatch && commentMatch.index !== undefined) {
      line = rawLine.slice(0, commentMatch.index);
    }
    if (!line.trim()) continue;

    const listMatch = line.match(/^\s*-\s*(.*)$/);
    if (listMatch && currentKey) {
      if (!currentArray) {
        currentArray = [];
        result[currentKey] = currentArray;
      }
      currentArray.push(parseScalar(listMatch[1]));
      continue;
    }

    const keyValMatch = line.match(/^\s*['"]?([A-Za-z0-9_-]+)['"]?\s*:\s*(.*)$/);
    if (keyValMatch) {
      const key = keyValMatch[1].trim();
      const rawVal = keyValMatch[2].trim();

      currentKey = key;
      currentArray = null;

      if (rawVal === '' || rawVal === '|' || rawVal === '>') {
        result[key] = '';
      } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        result[key] = parseScalar(rawVal);
      } else {
        result[key] = parseScalar(rawVal);
      }
      continue;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Parses commented YAML frontmatter from the beginning of a workflow file.
 * Handles blocks delimited by `# ---` or consecutive lines starting with `#`.
 */
export function parseCommentedFrontmatter(content: string): Record<string, unknown> | null {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const commentLines: string[] = [];
  let inDelimitedBlock = false;
  let hasDelimiters = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for delimiter line: `# ---`
    if (/^#\s*---\s*$/.test(trimmed)) {
      if (!inDelimitedBlock) {
        inDelimitedBlock = true;
        hasDelimiters = true;
        continue;
      } else {
        // End of delimited block
        break;
      }
    }

    if (inDelimitedBlock) {
      // Strip leading `# ` or `#`
      const stripped = line.replace(/^#\s?/, '');
      commentLines.push(stripped);
      continue;
    }

    // Non-delimited comments at the very top of file
    if (!hasDelimiters) {
      if (trimmed.startsWith('#')) {
        commentLines.push(line.replace(/^#\s?/, ''));
      } else if (trimmed === '') {
        // Skip empty lines before frontmatter
        continue;
      } else {
        // First non-comment, non-empty line
        break;
      }
    }
  }

  const yamlStr = commentLines.join('\n').trim();
  if (!yamlStr) {
    return null;
  }

  return parseSimpleYaml(yamlStr);
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

    const output = execFileSync('git', ['log', '--diff-filter=A', '--format=%aI', '-1', '--', resolvedPath], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
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
      : pkgData.name?.trim() || `@ghwfxlab/ghwm-${workflowName}`;

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
