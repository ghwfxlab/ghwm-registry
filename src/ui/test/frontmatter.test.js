import test from 'node:test';
import assert from 'node:assert';
import {
  parseCommentedFrontmatter,
  prettifyWorkflowName,
  resolveFallbackWorkflowMetadata,
  resolveLocalWorkflowMetadata,
  listLocalWorkflowNames,
  getGitCreationDate,
} from '../src/lib/frontmatter.ts';

test('test_parseCommentedFrontmatter_should_extract_yaml_from_delimited_block', () => {
  const sample = `
# ---
# title: Test Workflow
# description: A test description
# tags:
#   - test
#   - demo
# icon: rocket
# owner: testorg
# ---
---
name: Workflow
on: push
`;

  const result = parseCommentedFrontmatter(sample);
  assert.notStrictEqual(result, null);
  assert.strictEqual(result.title, 'Test Workflow');
  assert.strictEqual(result.description, 'A test description');
  assert.deepStrictEqual(result.tags, ['test', 'demo']);
  assert.strictEqual(result.icon, 'rocket');
  assert.strictEqual(result.owner, 'testorg');
});

test('test_parseCommentedFrontmatter_should_extract_yaml_from_plain_comments_without_delimiters', () => {
  const sample = `
# title: Plain Workflow
# description: Plain description
# tags: [one, two]
---
name: Plain
`;

  const result = parseCommentedFrontmatter(sample);
  assert.notStrictEqual(result, null);
  assert.strictEqual(result.title, 'Plain Workflow');
  assert.strictEqual(result.description, 'Plain description');
  assert.deepStrictEqual(result.tags, ['one', 'two']);
});

test('test_parseCommentedFrontmatter_should_return_null_for_invalid_or_missing_frontmatter', () => {
  assert.strictEqual(parseCommentedFrontmatter(''), null);
  assert.strictEqual(parseCommentedFrontmatter(null), null);
  assert.strictEqual(parseCommentedFrontmatter('--- \nname: Only YAML\n'), null);
  assert.strictEqual(parseCommentedFrontmatter('# Just a regular comment line\n\n---\nname: Test'), null);
});

test('test_prettifyWorkflowName_should_convert_hyphenated_names_to_title_case', () => {
  assert.strictEqual(prettifyWorkflowName('super-linter'), 'Super Linter');
  assert.strictEqual(prettifyWorkflowName('auto-assign-pr'), 'Auto Assign Pr');
  assert.strictEqual(prettifyWorkflowName('cloudrun-docker'), 'Cloudrun Docker');
  assert.strictEqual(prettifyWorkflowName(''), 'N/A');
  assert.strictEqual(prettifyWorkflowName(null), 'N/A');
});

test('test_resolveFallbackWorkflowMetadata_should_return_NA_for_unknown_attributes', () => {
  const meta = resolveFallbackWorkflowMetadata('cloudrun-docker');
  assert.strictEqual(meta.name, 'cloudrun-docker');
  assert.strictEqual(meta.title, 'Cloudrun Docker');
  assert.strictEqual(meta.description, 'N/A');
  assert.deepStrictEqual(meta.tags, ['N/A']);
  assert.strictEqual(meta.icon, 'extension');
  assert.strictEqual(meta.owner, 'N/A');
  assert.strictEqual(meta.packageName, 'N/A');
  assert.strictEqual(meta.version, 'N/A');
  assert.strictEqual(meta.createdAt, null);
});

test('test_resolveLocalWorkflowMetadata_should_load_super_linter_metadata', () => {
  const meta = resolveLocalWorkflowMetadata('super-linter');
  assert.strictEqual(meta.name, 'super-linter');
  assert.strictEqual(meta.title, 'Super-Linter');
  assert.ok(meta.description.includes('Super-Linter'));
  assert.ok(meta.tags.includes('lint'));
  assert.strictEqual(meta.icon, 'fact_check');
  assert.strictEqual(meta.owner, 'ghwfxlab');
  assert.strictEqual(meta.packageName, '@ghwfxlab/ghwm-super-linter');
  assert.strictEqual(meta.version, '1.0.1');
});

test('test_resolveLocalWorkflowMetadata_should_load_auto_assign_pr_metadata', () => {
  const meta = resolveLocalWorkflowMetadata('auto-assign-pr');
  assert.strictEqual(meta.name, 'auto-assign-pr');
  assert.strictEqual(meta.title, 'Auto Assign PR');
  assert.ok(meta.description.includes('reviewers'));
  assert.ok(meta.tags.includes('automation'));
  assert.strictEqual(meta.icon, 'person_add');
  assert.strictEqual(meta.owner, 'ghwfxlab');
  assert.strictEqual(meta.packageName, '@ghwfxlab/ghwm-auto-assign-pr');
  assert.strictEqual(meta.version, '1.0.1');
});

test('test_resolveLocalWorkflowMetadata_should_fallback_to_NA_for_nonexistent_workflow', () => {
  const meta = resolveLocalWorkflowMetadata('non-existent-workflow');
  assert.strictEqual(meta.name, 'non-existent-workflow');
  assert.strictEqual(meta.title, 'Non Existent Workflow');
  assert.strictEqual(meta.description, 'N/A');
  assert.strictEqual(meta.owner, 'N/A');
  assert.strictEqual(meta.version, 'N/A');
});

test('test_listLocalWorkflowNames_should_find_local_workflows', () => {
  const names = listLocalWorkflowNames();
  assert.ok(Array.isArray(names));
  assert.ok(names.includes('super-linter'));
  assert.ok(names.includes('auto-assign-pr'));
});

test('test_getGitCreationDate_should_return_iso_date_for_workflow_directory', () => {
  const date = getGitCreationDate('workflows/super-linter');
  assert.ok(date);
  assert.ok(!isNaN(new Date(date).getTime()));
});

test('test_getGitCreationDate_should_return_null_for_nonexistent_directory', () => {
  const date = getGitCreationDate('workflows/non-existent-directory-xyz');
  assert.strictEqual(date, null);
});

test('test_resolveLocalWorkflowMetadata_should_infer_createdAt_from_git_when_not_in_frontmatter', () => {
  const meta = resolveLocalWorkflowMetadata('super-linter');
  assert.ok(meta.createdAt);
  assert.ok(!isNaN(new Date(meta.createdAt).getTime()));
});
