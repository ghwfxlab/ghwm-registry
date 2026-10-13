// Pure, dependency-free frontmatter parsing. Safe to import from browser code.

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
