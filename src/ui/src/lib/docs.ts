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

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const EXTERNAL_LINK_ATTRIBUTES = 'target="_blank" rel="noopener noreferrer"';

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
  checkoutDir?: string;
  repo?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const docCache = new Map<string, Promise<LoadedDoc>>();
let docsTagPromise: Promise<string> | undefined;

/**
 * Resolves the ghwm release tag the docs are pinned to. Unlike the install-command helper this never
 * accepts the stale built-in fallback tag, because silently publishing old docs defeats the sync.
 */
export function getDocsTag(): Promise<string> {
  docsTagPromise ??= (async () => {
    const pinnedTag = process.env.GHWM_DOCS_TAG?.trim();
    if (pinnedTag) return pinnedTag;

    const latestTag = await fetchLatestGhwmTag();
    if (latestTag === DEFAULT_GHWM_TAG) {
      throw new Error(
        `Could not resolve the latest ghwm release tag (got fallback '${latestTag}', likely a GitHub API rate limit). ` +
          'Set GITHUB_TOKEN/GH_TOKEN, GHWM_DOCS_TAG, or GHWM_DOCS_DIR.'
      );
    }
    return latestTag;
  })();
  return docsTagPromise;
}

/** Builds the GitHub URLs that point back at a doc (and its sibling files) at a given ref. */
function describeDocLocation(repository: string, ref: string, docPath: string) {
  const blobBase = `https://github.com/${repository}/blob/${ref}`;
  return { sourceUrl: `${blobBase}/${docPath}`, blobBase };
}

function readDocFromCheckout(checkoutDir: string, repository: string, docPath: string): LoadedDoc {
  const docFile = path.resolve(checkoutDir, docPath);
  if (!fs.existsSync(docFile)) {
    throw new Error(`GHWM_DOCS_DIR is set but ${docFile} does not exist.`);
  }
  return {
    markdown: fs.readFileSync(docFile, 'utf8'),
    tag: null,
    ...describeDocLocation(repository, 'main', docPath),
  };
}

async function fetchDocFromRelease(
  repository: string,
  tag: string,
  docPath: string,
  fetchFn: typeof fetch,
  timeoutMs: number
): Promise<LoadedDoc> {
  const rawUrl = `https://raw.githubusercontent.com/${repository}/${tag}/${docPath}`;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetchFn(rawUrl, { signal: abortController.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${rawUrl}: HTTP ${response.status}`);
    }
    return {
      markdown: await response.text(),
      tag,
      ...describeDocLocation(repository, tag, docPath),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Loads a markdown file from the ghwm repository. Fails loudly instead of falling back to stale content.
 */
export function loadGhwmDoc(docPath: string, options: LoadGhwmDocOptions = {}): Promise<LoadedDoc> {
  const repository = options.repo || DEFAULT_GHWM_REPO;
  const checkoutDir = options.checkoutDir ?? process.env.GHWM_DOCS_DIR;
  const cacheKey = `${repository}|${checkoutDir ?? options.tag ?? ''}|${docPath}`;

  const cachedLoad = docCache.get(cacheKey);
  if (cachedLoad) return cachedLoad;

  const pendingLoad = (async (): Promise<LoadedDoc> => {
    if (checkoutDir) {
      return readDocFromCheckout(checkoutDir, repository, docPath);
    }
    const tag = options.tag ?? (await getDocsTag());
    return fetchDocFromRelease(
      repository,
      tag,
      docPath,
      options.fetchFn || fetch,
      options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    );
  })();

  // Do not cache failures, so a retry in the same process can succeed.
  pendingLoad.catch(() => docCache.delete(cacheKey));
  docCache.set(cacheKey, pendingLoad);
  return pendingLoad;
}

function isRegistryRoot(directory: string): boolean {
  return fs.existsSync(path.join(directory, 'CONTRIBUTING.md')) && fs.existsSync(path.join(directory, 'workflows'));
}

/**
 * Finds the root of this repository (the directory holding CONTRIBUTING.md and workflows/).
 */
export function findRegistryRoot(startDir: string = process.cwd()): string {
  let currentDir = path.resolve(startDir);
  while (currentDir !== path.dirname(currentDir)) {
    if (isRegistryRoot(currentDir)) return currentDir;
    currentDir = path.dirname(currentDir);
  }
  throw new Error(`Could not locate the ${REGISTRY_REPO} repository root from ${startDir}.`);
}

/** Loads a markdown file from this repository's checkout. */
export function loadRegistryDoc(docPath: string, registryRoot: string = findRegistryRoot()): LoadedDoc {
  return {
    markdown: fs.readFileSync(path.join(registryRoot, docPath), 'utf8'),
    tag: null,
    ...describeDocLocation(REGISTRY_REPO, 'main', docPath),
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

/** Matches the `[!NOTE]`-style marker GitHub puts at the start of an alert blockquote. */
const ALERT_MARKER_PATTERN = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/i;

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

  const anchorIndex = href.indexOf('#');
  const pathPart = anchorIndex === -1 ? href : href.slice(0, anchorIndex);
  const anchor = anchorIndex === -1 ? '' : href.slice(anchorIndex);
  const resolvedPath = path.posix.normalize(path.posix.join(options.docDir ?? '', pathPart));

  const siteRoute = options.linkMap?.[resolvedPath];
  if (siteRoute) return { href: `${siteRoute}${anchor}`, external: false };
  return { href: `${options.blobBase}/${resolvedPath}${anchor}`, external: true };
}

/** Removes a `## Heading` section (up to the next `## ` heading). */
export function removeSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const sectionStart = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (sectionStart === -1) return markdown;

  const nextHeadingIndex = lines.findIndex(
    (line, lineIndex) => lineIndex > sectionStart && line.startsWith('## ')
  );
  const sectionEnd = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
  return [...lines.slice(0, sectionStart), ...lines.slice(sectionEnd)].join('\n');
}

/** Drops everything before the first `## ` heading (after the title). */
export function dropPreamble(markdown: string): string {
  const firstSectionIndex = markdown.search(/^## /m);
  return firstSectionIndex === -1 ? markdown : markdown.slice(firstSectionIndex);
}

/** Splits off the first H1 so the page layout can render the title itself. */
function extractTitle(markdown: string): { title: string | null; body: string } {
  const titleMatch = markdown.match(/^# +(.+)\n/m);
  if (!titleMatch || titleMatch.index === undefined) return { title: null, body: markdown };

  const titleEnd = titleMatch.index + titleMatch[0].length;
  return {
    title: titleMatch[1].trim(),
    body: markdown.slice(0, titleMatch.index) + markdown.slice(titleEnd),
  };
}

/** Returns a function that gives each heading a unique GitHub-style id, numbering repeats. */
function createHeadingIdGenerator(): (headingText: string) => string {
  const usageCounts = new Map<string, number>();
  return (headingText) => {
    const baseSlug = slugify(headingText);
    const previousUses = usageCounts.get(baseSlug) ?? 0;
    usageCounts.set(baseSlug, previousUses + 1);
    return previousUses === 0 ? baseSlug : `${baseSlug}-${previousUses}`;
  };
}

function renderCodeBlock(code: string): string {
  return (
    '<div class="terminal-bg border border-outline-variant rounded-default overflow-hidden my-md">' +
    '<pre class="font-code-md text-code-md text-on-surface p-md overflow-x-auto m-0">' +
    `<code>${escapeHtml(code)}</code></pre></div>\n`
  );
}

function renderDiagramNote(sourceUrl: string): string {
  return (
    '<p><em>A diagram is available in the ' +
    `<a href="${escapeHtml(sourceUrl)}" ${EXTERNAL_LINK_ATTRIBUTES}>source document</a>.</em></p>\n`
  );
}

/** Renders a blockquote, turning GitHub alert syntax (`> [!NOTE]`) into a titled callout. */
function renderBlockquote(blockquoteHtml: string): string {
  const alertMarker = blockquoteHtml.match(ALERT_MARKER_PATTERN);
  if (!alertMarker) return `<blockquote>${blockquoteHtml}</blockquote>\n`;

  const alertKind = alertMarker[1].toUpperCase();
  const htmlAfterMarker = blockquoteHtml
    .slice(alertMarker[0].length)
    .replace(/^<\/p>\s*/, '<p>')
    .replace(/^<p><\/p>\s*/, '');
  const calloutBodyHtml = htmlAfterMarker.startsWith('<p>') ? htmlAfterMarker : `<p>${htmlAfterMarker}`;

  return (
    `<aside class="docs-callout" data-kind="${alertKind.toLowerCase()}">` +
    `<p class="docs-callout-title">${ALERT_TITLES[alertKind]}</p>${calloutBodyHtml}</aside>\n`
  );
}

export function renderMarkdown(markdown: string, options: RenderOptions): RenderedDoc {
  const { title, body } = extractTitle(markdown);
  const nextHeadingId = createHeadingIdGenerator();

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(token: Tokens.Heading) {
        const headingHtml = this.parser.parseInline(token.tokens);
        return `<h${token.depth} id="${nextHeadingId(token.text)}">${headingHtml}</h${token.depth}>\n`;
      },
      link(token: Tokens.Link) {
        const { href, external } = resolveLink(token.href, options);
        const titleAttribute = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        const externalAttributes = external ? ` ${EXTERNAL_LINK_ATTRIBUTES}` : '';
        const linkTextHtml = this.parser.parseInline(token.tokens);
        return `<a href="${escapeHtml(href)}"${titleAttribute}${externalAttributes}>${linkTextHtml}</a>`;
      },
      code(token: Tokens.Code) {
        return token.lang === 'mermaid' ? renderDiagramNote(options.sourceUrl) : renderCodeBlock(token.text);
      },
      blockquote(token: Tokens.Blockquote) {
        return renderBlockquote(this.parser.parse(token.tokens));
      },
    },
  });

  return { title, html: marked.parse(body, { async: false }) as string };
}

/**
 * Loads and renders one of the ghwm reference docs listed in GHWM_DOC_ROUTES.
 */
export async function getGhwmReferenceDoc(docPath: string): Promise<RenderedDoc & { source: LoadedDoc }> {
  const source = await loadGhwmDoc(docPath);
  const linkMap = Object.fromEntries(
    Object.entries(GHWM_DOC_ROUTES).map(([routedDocPath, route]) => [routedDocPath, withBase(route)])
  );
  const rendered = renderMarkdown(source.markdown, {
    docDir: path.posix.dirname(docPath),
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
