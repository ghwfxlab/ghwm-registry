import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getApiEndpoint,
  fetchUsageStats,
  fetchWorkflowStats,
  getTrendingWorkflows,
  getWorkflowDetails,
  getAllWorkflowTags,
  formatLastInstalled,
  isOfficialProvider,
  getOfficialWorkflows,
  getNewArrivals,
  OFFICIAL_PROVIDERS,
  CATALOG_WORKFLOWS,
  DEFAULT_PROD_API_URL,
  DEFAULT_TEST_API_URL,
} from '../src/lib/usage.ts';

// Helper to temporarily stub global fetch
function mockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    return handler(url.toString(), init);
  };
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('test_getApiEndpoint_should_return_empty_string_when_no_environment_variables_are_set', () => {
  // Arrange
  const originalPublic = process.env.PUBLIC_API_URL;
  const originalGhwm = process.env.GHWM_API_URL;
  const originalApi = process.env.API_URL;
  delete process.env.PUBLIC_API_URL;
  delete process.env.GHWM_API_URL;
  delete process.env.API_URL;

  try {
    // Act
    const endpoint = getApiEndpoint();

    // Assert
    assert.strictEqual(endpoint, '');
  } finally {
    if (originalPublic !== undefined) process.env.PUBLIC_API_URL = originalPublic;
    if (originalGhwm !== undefined) process.env.GHWM_API_URL = originalGhwm;
    if (originalApi !== undefined) process.env.API_URL = originalApi;
  }
});

test('test_getApiEndpoint_should_return_trimmed_url_without_trailing_slash_when_public_api_url_is_set', () => {
  // Arrange
  const originalPublic = process.env.PUBLIC_API_URL;
  process.env.PUBLIC_API_URL = '  https://ghwm-deployment-tst.ghwfxlab.workers.dev///  ';

  try {
    // Act
    const endpoint = getApiEndpoint();

    // Assert
    assert.strictEqual(endpoint, 'https://ghwm-deployment-tst.ghwfxlab.workers.dev');
  } finally {
    if (originalPublic !== undefined) {
      process.env.PUBLIC_API_URL = originalPublic;
    } else {
      delete process.env.PUBLIC_API_URL;
    }
  }
});

test('test_fetchUsageStats_should_return_null_when_endpoint_is_empty', async () => {
  // Arrange
  const endpoint = '';

  // Act
  const result = await fetchUsageStats(endpoint);

  // Assert
  assert.strictEqual(result, null);
});

test('test_fetchUsageStats_should_return_null_when_api_responds_with_error_status', async () => {
  // Arrange
  const restore = mockFetch(async () => {
    return new Response('Internal Server Error', { status: 500 });
  });

  try {
    // Act
    const result = await fetchUsageStats('https://api.example.com');

    // Assert
    assert.strictEqual(result, null);
  } finally {
    restore();
  }
});

test('test_fetchUsageStats_should_return_registry_stats_when_api_responds_successfully', async () => {
  // Arrange
  const mockPayload = {
    source: null,
    total_installations: 42,
    workflows: [
      {
        workflow_name: 'super-linter',
        installs: 30,
        updates: 5,
        total: 35,
        last_installed_at: '2026-09-08T13:36:35.173Z',
      },
    ],
  };

  const restore = mockFetch(async (url) => {
    assert.strictEqual(url, 'https://api.example.com/stats');
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    // Act
    const result = await fetchUsageStats('https://api.example.com');

    // Assert
    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.total_installations, 42);
    assert.strictEqual(result?.workflows.length, 1);
    assert.strictEqual(result?.workflows[0].workflow_name, 'super-linter');
  } finally {
    restore();
  }
});

test('test_fetchWorkflowStats_should_return_null_when_endpoint_or_workflow_is_empty', async () => {
  // Arrange & Act
  const resultEmptyEndpoint = await fetchWorkflowStats('super-linter', '');
  const resultEmptyName = await fetchWorkflowStats('', 'https://api.example.com');

  // Assert
  assert.strictEqual(resultEmptyEndpoint, null);
  assert.strictEqual(resultEmptyName, null);
});

test('test_fetchWorkflowStats_should_return_workflow_stats_when_api_responds_successfully', async () => {
  // Arrange
  const mockPayload = {
    workflow_name: 'super-linter',
    source: null,
    installs: 3,
    updates: 0,
    total: 3,
    last_installed_at: '2026-09-08T13:36:35.173Z',
  };

  const restore = mockFetch(async (url) => {
    assert.strictEqual(url, 'https://api.example.com/workflows/super-linter/stats');
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    // Act
    const result = await fetchWorkflowStats('super-linter', 'https://api.example.com');

    // Assert
    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.workflow_name, 'super-linter');
    assert.strictEqual(result?.installs, 3);
  } finally {
    restore();
  }
});

test('test_getTrendingWorkflows_should_fallback_to_catalog_with_zero_installs_when_endpoint_is_empty', async () => {
  // Arrange
  const emptyEndpoint = '';

  // Act
  const result = await getTrendingWorkflows(emptyEndpoint);

  // Assert
  assert.strictEqual(result.isConnected, false);
  assert.strictEqual(result.apiEndpoint, null);
  assert.strictEqual(result.totalInstallations, 0);
  assert.strictEqual(result.workflows.length, CATALOG_WORKFLOWS.length);
  assert.strictEqual(result.workflows[0].installs, 0);
});

test('test_getTrendingWorkflows_should_merge_live_usage_stats_and_mark_connected_when_api_responds_successfully', async () => {
  // Arrange
  const mockPayload = {
    source: null,
    total_installations: 3,
    workflows: [
      {
        workflow_name: 'super-linter',
        installs: 3,
        updates: 0,
        total: 3,
        last_installed_at: '2026-09-08T13:36:35.173Z',
      },
    ],
  };

  const restore = mockFetch(async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    // Act
    const result = await getTrendingWorkflows('https://ghwm-deployment-tst.ghwfxlab.workers.dev');

    // Assert
    assert.strictEqual(result.isConnected, true);
    assert.strictEqual(result.apiEndpoint, 'https://ghwm-deployment-tst.ghwfxlab.workers.dev');
    assert.strictEqual(result.totalInstallations, 3);

    const superLinter = result.workflows.find((w) => w.name === 'super-linter');
    assert.notStrictEqual(superLinter, undefined);
    assert.strictEqual(superLinter?.installs, 3);

    const autoAssign = result.workflows.find((w) => w.name === 'auto-assign-pr');
    assert.notStrictEqual(autoAssign, undefined);
    assert.strictEqual(autoAssign?.installs, 0);
  } finally {
    restore();
  }
});

test('test_getTrendingWorkflows_should_sort_workflows_by_installs_descending_when_usage_data_is_present', async () => {
  // Arrange
  const mockPayload = {
    source: null,
    total_installations: 15,
    workflows: [
      {
        workflow_name: 'auto-assign-pr',
        installs: 10,
        updates: 0,
        total: 10,
        last_installed_at: null,
      },
      {
        workflow_name: 'super-linter',
        installs: 5,
        updates: 0,
        total: 5,
        last_installed_at: null,
      },
    ],
  };

  const restore = mockFetch(async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    // Act
    const result = await getTrendingWorkflows('https://api.example.com');

    // Assert
    assert.strictEqual(result.workflows[0].name, 'auto-assign-pr');
    assert.strictEqual(result.workflows[0].installs, 10);
    assert.strictEqual(result.workflows[1].name, 'super-linter');
    assert.strictEqual(result.workflows[1].installs, 5);
  } finally {
    restore();
  }
});

test('test_formatLastInstalled_should_return_formatted_date_when_valid_iso_provided', () => {
  // Arrange
  const isoDate = '2026-09-08T13:36:35.173Z';

  // Act
  const formatted = formatLastInstalled(isoDate);

  // Assert
  assert.strictEqual(formatted, 'Sep 8, 2026');
});

test('test_formatLastInstalled_should_return_null_when_null_or_invalid_date_provided', () => {
  // Arrange & Act
  const fromNull = formatLastInstalled(null);
  const fromInvalid = formatLastInstalled('not-a-date');

  // Assert
  assert.strictEqual(fromNull, null);
  assert.strictEqual(fromInvalid, null);
});

test('test_getWorkflowDetails_should_return_workflow_details_with_live_stats_when_workflow_exists', async () => {
  // Arrange
  const mockPayload = {
    workflow_name: 'super-linter',
    source: null,
    installs: 3,
    updates: 1,
    total: 4,
    last_installed_at: '2026-09-08T13:36:35.173Z',
  };

  const restore = mockFetch(async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    // Act
    const details = await getWorkflowDetails('super-linter', 'https://api.example.com');

    // Assert
    assert.notStrictEqual(details, null);
    assert.strictEqual(details?.name, 'super-linter');
    assert.strictEqual(details?.version, '1.0.0');
    assert.strictEqual(details?.installs, 3);
    assert.strictEqual(details?.updates, 1);
    assert.strictEqual(details?.total, 4);
    assert.strictEqual(details?.lastInstalledAt, '2026-09-08T13:36:35.173Z');
  } finally {
    restore();
  }
});

test('test_getWorkflowDetails_should_return_null_when_workflow_does_not_exist', async () => {
  // Arrange & Act
  const details = await getWorkflowDetails('non-existent-workflow', 'https://api.example.com');

  // Assert
  assert.strictEqual(details, null);
});

test('test_getAllWorkflowTags_should_return_sorted_unique_tags_when_catalog_workflows_exist', () => {
  // Act
  const tags = getAllWorkflowTags();

  // Assert
  assert.ok(Array.isArray(tags));
  assert.ok(tags.includes('lint'));
  assert.ok(tags.includes('automation'));
  assert.strictEqual(new Set(tags).size, tags.length);
  const sorted = [...tags].sort();
  assert.deepStrictEqual(tags, sorted);
});

test('test_isOfficialProvider_should_return_true_for_ghwfxlab', () => {
  assert.strictEqual(isOfficialProvider('ghwfxlab'), true);
  assert.ok(OFFICIAL_PROVIDERS.includes('ghwfxlab'));
});

test('test_isOfficialProvider_should_return_false_for_unknown_or_empty_provider', () => {
  assert.strictEqual(isOfficialProvider('unknown-org'), false);
  assert.strictEqual(isOfficialProvider(''), false);
  assert.strictEqual(isOfficialProvider(null), false);
  assert.strictEqual(isOfficialProvider(undefined), false);
});

test('test_catalog_workflows_should_all_have_official_owner', () => {
  for (const workflow of CATALOG_WORKFLOWS) {
    assert.strictEqual(isOfficialProvider(workflow.owner), true);
    assert.strictEqual(workflow.owner, 'ghwfxlab');
  }
});

test('test_getOfficialWorkflows_should_filter_only_official_workflows', async () => {
  // Act
  const result = await getOfficialWorkflows('');

  // Assert
  assert.ok(Array.isArray(result.workflows));
  assert.ok(result.workflows.length > 0);
  for (const workflow of result.workflows) {
    assert.strictEqual(workflow.owner, 'ghwfxlab');
  }
});

test('test_getNewArrivals_should_return_workflows_sorted_by_newest_first', async () => {
  // Act
  const arrivals = await getNewArrivals('');

  // Assert
  assert.ok(Array.isArray(arrivals));
  assert.strictEqual(arrivals.length, 2);
  // auto-assign-pr was added 2026-09-08, super-linter was added 2026-09-01
  assert.strictEqual(arrivals[0].name, 'auto-assign-pr');
  assert.strictEqual(arrivals[1].name, 'super-linter');
});

test('test_getNewArrivals_should_respect_limit_parameter', async () => {
  // Act
  const arrivals = await getNewArrivals('', 1);

  // Assert
  assert.strictEqual(arrivals.length, 1);
  assert.strictEqual(arrivals[0].name, 'auto-assign-pr');
});

test('test_getNewArrivals_should_default_to_5_limit', async () => {
  // Act
  const arrivals = await getNewArrivals('');

  // Assert
  assert.ok(arrivals.length <= 5);
});

test('test_constants_should_expose_valid_production_and_test_api_endpoints', () => {
  assert.strictEqual(DEFAULT_PROD_API_URL, 'https://ghwm-deployment-prd.ghwfxlab.workers.dev');
  assert.strictEqual(DEFAULT_TEST_API_URL, 'https://ghwm-deployment-tst.ghwfxlab.workers.dev');
});



