import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkflowPermissions, resolveLocalWorkflowPermissions } from '../src/lib/permissions.ts';

test('test_parseWorkflowPermissions_should_return_empty_for_empty_permissions', () => {
  assert.deepStrictEqual(parseWorkflowPermissions('name: x\npermissions: {}\njobs: {}\n'), []);
});

test('test_parseWorkflowPermissions_should_merge_job_scopes_with_highest_access', () => {
  const yaml = [
    'permissions: {}',
    'jobs:',
    '  a:',
    '    permissions:',
    '      contents: read',
    '  b:',
    '    permissions:',
    '      contents: write # push tags',
    '      id-token: write',
    '    steps: []',
  ].join('\n');

  assert.deepStrictEqual(parseWorkflowPermissions(yaml), [
    { scope: 'contents', access: 'write' },
    { scope: 'id-token', access: 'write' },
  ]);
});

test('test_resolveLocalWorkflowPermissions_should_reflect_each_workflow', () => {
  assert.deepStrictEqual(resolveLocalWorkflowPermissions('publish-pypi'), [
    { scope: 'contents', access: 'read' },
    { scope: 'id-token', access: 'write' },
  ]);
  assert.deepStrictEqual(resolveLocalWorkflowPermissions('auto-assign-pr'), [
    { scope: 'contents', access: 'write' },
    { scope: 'pull-requests', access: 'write' },
  ]);
  assert.strictEqual(resolveLocalWorkflowPermissions('does-not-exist'), null);
});
