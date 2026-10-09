import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dropPreamble,
  findRegistryRoot,
  loadGhwmDoc,
  removeSection,
  renderMarkdown,
  resolveLink,
  slugify,
} from '../src/lib/docs.ts';

const renderOptions = {
  docDir: 'docs/reference',
  linkMap: { 'docs/reference/frontmatter.md': '/ghwm/docs/frontmatter/' },
  blobBase: 'https://github.com/ghwfxlab/ghwm/blob/v1.9.0',
  sourceUrl: 'https://github.com/ghwfxlab/ghwm/blob/v1.9.0/docs/reference/manifest.md',
};

test('test_slugify_should_match_github_anchor_rules', () => {
  assert.equal(slugify('`ghwm.yml`'), 'ghwmyml');
  assert.equal(slugify('Resolution Precedence Hierarchy'), 'resolution-precedence-hierarchy');
  assert.equal(slugify('1. Mapping Syntax (Recommended)'), '1-mapping-syntax-recommended');
});

test('test_resolveLink_should_keep_anchors_and_absolute_urls', () => {
  assert.deepEqual(resolveLink('#overview', renderOptions), { href: '#overview', external: false });
  assert.deepEqual(resolveLink('https://example.com/x', renderOptions), {
    href: 'https://example.com/x',
    external: true,
  });
  assert.deepEqual(resolveLink('mailto:a@example.com', renderOptions), {
    href: 'mailto:a@example.com',
    external: false,
  });
});

test('test_resolveLink_should_route_known_docs_to_the_site_and_keep_the_hash', () => {
  assert.deepEqual(resolveLink('frontmatter.md#syntax', renderOptions), {
    href: '/ghwm/docs/frontmatter/#syntax',
    external: false,
  });
  assert.deepEqual(resolveLink('./frontmatter.md', renderOptions), {
    href: '/ghwm/docs/frontmatter/',
    external: false,
  });
});

test('test_resolveLink_should_send_unknown_relative_links_to_github_at_the_pinned_ref', () => {
  assert.deepEqual(resolveLink('../ARCHITECTURE.md', renderOptions), {
    href: 'https://github.com/ghwfxlab/ghwm/blob/v1.9.0/docs/ARCHITECTURE.md',
    external: true,
  });
});

test('test_renderMarkdown_should_extract_and_drop_the_first_h1', () => {
  const { title, html } = renderMarkdown('# Manifest Reference\n\nIntro text.\n', renderOptions);

  assert.equal(title, 'Manifest Reference');
  assert.ok(!html.includes('<h1'));
  assert.ok(html.includes('<p>Intro text.</p>'));
});

test('test_renderMarkdown_should_add_github_style_heading_ids_and_dedupe_repeats', () => {
  const { html } = renderMarkdown('## Overview\n\n## Overview\n\n### `source`\n', renderOptions);

  assert.ok(html.includes('<h2 id="overview">Overview</h2>'));
  assert.ok(html.includes('<h2 id="overview-1">Overview</h2>'));
  assert.ok(html.includes('<h3 id="source"><code>source</code></h3>'));
});

test('test_renderMarkdown_should_convert_github_alerts_to_callouts', () => {
  const { html } = renderMarkdown('> [!WARNING]\n> Use explicit delimiters.\n', renderOptions);

  assert.ok(html.includes('<aside class="docs-callout" data-kind="warning">'));
  assert.ok(html.includes('<p class="docs-callout-title">Warning</p>'));
  assert.ok(html.includes('<p>Use explicit delimiters.</p>'));
  assert.ok(!html.includes('[!WARNING]'));
});

test('test_renderMarkdown_should_leave_plain_blockquotes_alone', () => {
  const { html } = renderMarkdown('> just a quote\n', renderOptions);

  assert.ok(html.startsWith('<blockquote>'));
  assert.ok(!html.includes('docs-callout'));
});

test('test_renderMarkdown_should_rewrite_links_and_open_external_ones_in_a_new_tab', () => {
  const { html } = renderMarkdown(
    '[local](frontmatter.md#a) and [remote](https://example.com) and [file](../ARCHITECTURE.md)',
    renderOptions
  );

  assert.ok(html.includes('<a href="/ghwm/docs/frontmatter/#a">local</a>'));
  assert.ok(html.includes('<a href="https://example.com" target="_blank" rel="noopener noreferrer">remote</a>'));
  assert.ok(html.includes('href="https://github.com/ghwfxlab/ghwm/blob/v1.9.0/docs/ARCHITECTURE.md"'));
});

test('test_renderMarkdown_should_replace_mermaid_diagrams_with_a_source_link', () => {
  const { html } = renderMarkdown('```mermaid\nflowchart TD\n  A --> B\n```\n', renderOptions);

  assert.ok(!html.includes('flowchart'));
  assert.ok(html.includes(`href="${renderOptions.sourceUrl}"`));
});

test('test_renderMarkdown_should_escape_code_block_content', () => {
  const { html } = renderMarkdown('```yaml\non: <push> & "x"\n```\n', renderOptions);

  assert.ok(html.includes('on: &lt;push&gt; &amp; &quot;x&quot;'));
  assert.ok(html.includes('terminal-bg'));
});

test('test_removeSection_and_dropPreamble_should_trim_a_document', () => {
  const md = 'Thanks!\n\n## Table of Contents\n\n- a\n\n## Real\n\ntext\n';

  assert.equal(dropPreamble(md), '## Table of Contents\n\n- a\n\n## Real\n\ntext\n');
  assert.equal(removeSection(dropPreamble(md), 'Table of Contents'), '## Real\n\ntext\n');
  assert.equal(removeSection(md, 'Missing'), md);
});

test('test_loadGhwmDoc_should_fetch_from_the_pinned_tag', async () => {
  let requested = '';
  const doc = await loadGhwmDoc('docs/reference/manifest.md', {
    tag: 'v9.9.9',
    dir: '',
    fetchFn: async (url) => {
      requested = url.toString();
      return new Response('# Hello', { status: 200 });
    },
  });

  assert.equal(requested, 'https://raw.githubusercontent.com/ghwfxlab/ghwm/v9.9.9/docs/reference/manifest.md');
  assert.equal(doc.markdown, '# Hello');
  assert.equal(doc.tag, 'v9.9.9');
  assert.equal(doc.sourceUrl, 'https://github.com/ghwfxlab/ghwm/blob/v9.9.9/docs/reference/manifest.md');
  assert.equal(doc.blobBase, 'https://github.com/ghwfxlab/ghwm/blob/v9.9.9');
});

test('test_loadGhwmDoc_should_throw_instead_of_serving_stale_docs_when_the_fetch_fails', async () => {
  await assert.rejects(
    loadGhwmDoc('docs/reference/missing.md', {
      tag: 'v9.9.9',
      dir: '',
      fetchFn: async () => new Response('nope', { status: 404 }),
    }),
    /HTTP 404/
  );
});

test('test_loadGhwmDoc_should_not_cache_failures', async () => {
  const options = { tag: 'v9.9.9', dir: '' };
  await assert.rejects(
    loadGhwmDoc('docs/reference/retry.md', { ...options, fetchFn: async () => new Response('', { status: 500 }) })
  );

  const doc = await loadGhwmDoc('docs/reference/retry.md', {
    ...options,
    fetchFn: async () => new Response('ok', { status: 200 }),
  });
  assert.equal(doc.markdown, 'ok');
});

test('test_loadGhwmDoc_should_read_from_a_local_checkout_when_dir_is_set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghwm-docs-'));
  try {
    fs.mkdirSync(path.join(dir, 'docs', 'reference'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'reference', 'manifest.md'), '# Local');

    const doc = await loadGhwmDoc('docs/reference/manifest.md', {
      dir,
      fetchFn: async () => {
        throw new Error('should not fetch');
      },
    });

    assert.equal(doc.markdown, '# Local');
    assert.equal(doc.tag, null);
    await assert.rejects(loadGhwmDoc('docs/reference/nope.md', { dir }), /does not exist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('test_findRegistryRoot_should_locate_the_repository_root_from_the_ui_directory', () => {
  const root = findRegistryRoot(process.cwd());

  assert.ok(fs.existsSync(path.join(root, 'CONTRIBUTING.md')));
  assert.ok(fs.existsSync(path.join(root, 'workflows')));
});
