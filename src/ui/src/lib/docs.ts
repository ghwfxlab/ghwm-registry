import fs from 'node:fs';
import path from 'node:path';
import { Marked, type Tokens } from 'marked';
import { DEFAULT_GHWM_REPO, DEFAULT_GHWM_TAG, fetchLatestGhwmTag } from './github.ts';
import { withBase } from './paths.ts';

/**
 * Docs sync
 *
 * The CLI reference docs live in the ghwm repository and are pulled in at build time from the latest
 * release tag (or from a local checkout via GHWM_DOCS_DIR), so the site never carries a hand-copied
 * version. Registry-specific docs are rendered from this repository's own markdown (CONTRIBUTING.md).
 *
 * Markdown comes from our own repositories and is rendered as-is (raw HTML is not sanitized).
 */

export const REGISTRY_REPO = 'ghwfxlab/ghwm-registry';

/** Repo-relative ghwm doc paths mapped to the site route that renders them. */
export const GHWM_DOC_ROUTES: Record<string, string> = {
  'docs/reference/manifest.md': '/docs/manifest/',
  'docs/reference/frontmatter.md': '/docs/frontmatter/',
};

export interface LoadedDoc {
  markdown: string;
  /** Release tag the doc was fetched from, or null when read from a local checkout. */
  tag: string | null;
  /** Human-viewable URL of the source document. */
  sourceUrl: string;
  /** Base for GitHub blob links to other files in the source repository. */
  blobBase: string;
}

export interface LoadGhwmDocOptions {
  tag?: string;
  /** Path to a local ghwm checkout. Defaults to the GHWM_DOCS_DIR environment variable. */
  dir?: string;
  repo?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const docCache = new Map<string, Promise<LoadedDoc>>();
let tagPromise: Promise<string> | undefined;

/**
 * Resolves the ghwm release tag the docs are pinned to. Unlike the install-command helper this never
 * accepts the stale built-in fallback tag, because silently publishing old docs defeats the sync.
 */
export function getDocsTag(): Promise<string> {
  tagPromise ??= (async () => {
    const override = process.env.GHWM_DOCS_TAG?.trim();
    if (override) return override;
    const tag = await fetchLatestGhwmTag();
    if (tag === DEFAULT_GHWM_TAG) {
      throw new Error(
        `Could not resolve the latest ghwm release tag (got fallback '${tag}', likely a GitHub API rate limit). ` +
          'Set GITHUB_TOKEN/GH_TOKEN, GHWM_DOCS_TAG, or GHWM_DOCS_DIR.'
      );
    }
    return tag;
  })();
  return tagPromise;
}

/**
 * Loads a markdown file from the ghwm repository. Fails loudly instead of falling back to stale content.
 */
export function loadGhwmDoc(relPath: string, options: LoadGhwmDocOptions = {}): Promise<LoadedDoc> {
  const repo = options.repo || DEFAULT_GHWM_REPO;
  const dir = options.dir ?? process.env.GHWM_DOCS_DIR;
  const cacheKey = `${repo}|${dir ?? options.tag ?? ''}|${relPath}`;
  const cached = docCache.get(cacheKey);
  if (cached) return cached;

  const loading = (async (): Promise<LoadedDoc> => {
    if (dir) {
      const file = path.resolve(dir, relPath);
      if (!fs.existsSync(file)) {
        throw new Error(`GHWM_DOCS_DIR is set but ${file} does not exist.`);
      }
      return {
        markdown: fs.readFileSync(file, 'utf8'),
        tag: null,
        sourceUrl: `https://github.com/${repo}/blob/main/${relPath}`,
        blobBase: `https://github.com/${repo}/blob/main`,
      };
    }

    const tag = options.tag ?? (await getDocsTag());
    const url = `https://raw.githubusercontent.com/${repo}/${tag}/${relPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
    try {
      const res = await (options.fetchFn || fetch)(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
      }
      return {
        markdown: await res.text(),
        tag,
        sourceUrl: `https://github.com/${repo}/blob/${tag}/${relPath}`,
        blobBase: `https://github.com/${repo}/blob/${tag}`,
      };
    } finally {
      clearTimeout(timer);
    }
  })();

  // Do not cache failures, so a retry in the same process can succeed.
  loading.catch(() => docCache.delete(cacheKey));
  docCache.set(cacheKey, loading);
  return loading;
}

/**
 * Finds the root of this repository (the directory holding CONTRIBUTING.md and workflows/).
 */
export function findRegistryRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'CONTRIBUTING.md')) && fs.existsSync(path.join(dir, 'workflows'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Could not locate the ${REGISTRY_REPO} repository root from ${start}.`);
}

/** Loads a markdown file from this repository's checkout. */
export function loadRegistryDoc(relPath: string, root: string = findRegistryRoot()): LoadedDoc {
  return {
    markdown: fs.readFileSync(path.join(root, relPath), 'utf8'),
    tag: null,
    sourceUrl: `https://github.com/${REGISTRY_REPO}/blob/main/${relPath}`,
    blobBase: `https://github.com/${REGISTRY_REPO}/blob/main`,
  };
}

// --- Markdown rendering ---------------------------------------------------------------------------

export interface RenderOptions {
  /** Repo-relative directory of the document, used to resolve its relative links. */
  docDir?: string;
  /** Repo-relative file paths mapped to site routes; matching links stay on the site. */
  linkMap?: Record<string, string>;
  /** Base for GitHub blob links used for relative links that are not on the site. */
  blobBase: string;
  /** URL of the source document, linked in place of diagrams that cannot be rendered. */
  sourceUrl: string;
}

export interface RenderedDoc {
  /** Text of the first H1 (not included in `html`). */
  title: string | null;
  html: string;
}

const ALERT_TITLES: Record<string, string> = {
  NOTE: 'Note',
  TIP: 'Tip',
  IMPORTANT: 'Important',
  WARNING: 'Warning',
  CAUTION: 'Caution',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** GitHub-style heading anchor, so in-document links written for GitHub keep working. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Rewrites a link from a GitHub-rendered document so it works on the site. */
export function resolveLink(href: string, options: RenderOptions): { href: string; external: boolean } {
  if (href.startsWith('#')) return { href, external: false };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return { href, external: /^https?:/i.test(href) };
  }

  const hashIndex = href.indexOf('#');
  const filePart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : href.slice(hashIndex);
  const resolved = path.posix.normalize(path.posix.join(options.docDir ?? '', filePart));

  const route = options.linkMap?.[resolved];
  if (route) return { href: `${route}${hash}`, external: false };
  return { href: `${options.blobBase}/${resolved}${hash}`, external: true };
}

/** Removes a `## Heading` section (up to the next `## ` heading). */
export function removeSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return markdown;
  let end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

/** Drops everything before the first `## ` heading (after the title). */
export function dropPreamble(markdown: string): string {
  const index = markdown.search(/^## /m);
  return index === -1 ? markdown : markdown.slice(index);
}

export function renderMarkdown(markdown: string, options: RenderOptions): RenderedDoc {
  let title: string | null = null;
  const body = markdown.replace(/^# +(.+)\n/m, (_match, text: string) => {
    title = text.trim();
    return '';
  });

  const seen = new Map<string, number>();

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(token: Tokens.Heading) {
        const base = slugify(token.text);
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        return `<h${token.depth} id="${id}">${this.parser.parseInline(token.tokens)}</h${token.depth}>\n`;
      },
      link(token: Tokens.Link) {
        const { href, external } = resolveLink(token.href, options);
        const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escapeHtml(href)}"${titleAttr}${rel}>${this.parser.parseInline(token.tokens)}</a>`;
      },
      code(token: Tokens.Code) {
        if (token.lang === 'mermaid') {
          return `<p><em>A diagram is available in the <a href="${escapeHtml(options.sourceUrl)}" target="_blank" rel="noopener noreferrer">source document</a>.</em></p>\n`;
        }
        return (
          '<div class="terminal-bg border border-outline-variant rounded-default overflow-hidden my-md">' +
          '<pre class="font-code-md text-code-md text-on-surface p-md overflow-x-auto m-0">' +
          `<code>${escapeHtml(token.text)}</code></pre></div>\n`
        );
      },
      blockquote(token: Tokens.Blockquote) {
        const inner = this.parser.parse(token.tokens);
        const alert = inner.match(/^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i);
        if (!alert) return `<blockquote>${inner}</blockquote>\n`;

        const kind = alert[1].toUpperCase();
        const rest = inner.slice(alert[0].length).replace(/^<\/p>\s*/, '<p>').replace(/^<p><\/p>\s*/, '');
        const content = rest.startsWith('<p>') ? rest : `<p>${rest}`;
        return (
          `<aside class="docs-callout" data-kind="${kind.toLowerCase()}">` +
          `<p class="docs-callout-title">${ALERT_TITLES[kind]}</p>${content}</aside>\n`
        );
      },
    },
  });

  return { title, html: marked.parse(body, { async: false }) as string };
}

/**
 * Loads and renders one of the ghwm reference docs listed in GHWM_DOC_ROUTES.
 */
export async function getGhwmReferenceDoc(relPath: string): Promise<RenderedDoc & { source: LoadedDoc }> {
  const source = await loadGhwmDoc(relPath);
  const linkMap = Object.fromEntries(
    Object.entries(GHWM_DOC_ROUTES).map(([file, route]) => [file, withBase(route)])
  );
  const rendered = renderMarkdown(source.markdown, {
    docDir: path.posix.dirname(relPath),
    linkMap,
    blobBase: source.blobBase,
    sourceUrl: source.sourceUrl,
  });
  return { ...rendered, source };
}

/**
 * Renders this repository's CONTRIBUTING.md as the "Writing a package" guide.
 */
export function getContributingDoc(): RenderedDoc & { source: LoadedDoc } {
  const source = loadRegistryDoc('CONTRIBUTING.md');
  const markdown = removeSection(dropPreamble(source.markdown), 'Table of Contents');
  const rendered = renderMarkdown(markdown, {
    docDir: '',
    blobBase: source.blobBase,
    sourceUrl: source.sourceUrl,
  });
  return { ...rendered, source };
}
