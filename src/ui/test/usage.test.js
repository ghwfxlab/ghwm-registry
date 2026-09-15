import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  getApiEndpoint,
  fetchCatalog,
  fetchUsageStats,
  fetchWorkflowStats,
  fetchWorkflowDetails,
  syncWorkflowCatalog,
  getTrendingWorkflows,
  getWorkflowDetails,
  getAllWorkflowTags,
  formatLastInstalled,
  isOfficialProvider,
  getOfficialWorkflows,
  getNewArrivals,
  OFFICIAL_PROVIDERS,
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
  const stats = await fetchUsageStats('');
  assert.strictEqual(stats, null);
});

test('test_fetchUsageStats_should_return_null_when_api_responds_with_error_status', async () => {
  // Arrange
  const restore = mockFetch(async () => {
    return new Response(JSON.stringify({ error: 'internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    // Act
    const stats = await fetchUsageStats('https://api.example.com');

    // Assert
    assert.strictEqual(stats, null);
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

  const restore = mockFetch(async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    // Act
    const stats = await fetchUsageStats('https://api.example.com');

    // Assert
    assert.notStrictEqual(stats, null);
    assert.strictEqual(stats?.total_installations, 42);
    assert.strictEqual(stats?.workflows.length, 1);
    assert.strictEqual(stats?.workflows[0].workflow_name, 'super-linter');
    assert.strictEqual(stats?.workflows[0].installs, 30);
  } finally {
    restore();
  }
});

test('test_fetchWorkflowStats_should_return_null_when_endpoint_or_workflow_is_empty', async () => {
  assert.strictEqual(await fetchWorkflowStats('', 'https://api.example.com'), null);
  assert.strictEqual(await fetchWorkflowStats('super-linter', ''), null);
});

test('test_fetchWorkflowStats_should_return_workflow_stats_when_api_responds_successfully', async () => {
  // Arrange
  const mockPayload = {
    workflow_name: 'super-linter',
    source: null,
    installs: 7,
    updates: 2,
    total: 9,
    last_installed_at: '2026-09-08T13:36:35.173Z',
  };

  const restore = mockFetch(async (url) => {
    assert.ok(url.includes('/workflows/super-linter/stats'));
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    // Act
    const stat = await fetchWorkflowStats('super-linter', 'https://api.example.com');

    // Assert
    assert.notStrictEqual(stat, null);
    assert.strictEqual(stat?.workflow_name, 'super-linter');
    assert.strictEqual(stat?.installs, 7);
    assert.strictEqual(stat?.total, 9);
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
  assert.strictEqual(result.workflows.length, 2);
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
  } finally {
    restore();
  }
});

test('test_getTrendingWorkflows_should_handle_external_workflows_with_NA_metadata', async () => {
  // Arrange
  const mockPayload = {
    source: null,
    total_installations: 4,
    workflows: [
      {
        workflow_name: 'super-linter',
        installs: 3,
        updates: 0,
        total: 3,
        last_installed_at: '2026-09-08T13:36:35.173Z',
      },
      {
        workflow_name: 'cloudrun-docker',
        installs: 1,
        updates: 0,
        total: 1,
        last_installed_at: '2026-09-12T07:58:39.920Z',
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
    assert.strictEqual(result.workflows.length, 2);
    const cloudrun = result.workflows.find((w) => w.name === 'cloudrun-docker');
    assert.notStrictEqual(cloudrun, undefined);
    assert.strictEqual(cloudrun?.title, 'Cloudrun Docker');
    assert.strictEqual(cloudrun?.description, 'N/A');
    assert.deepStrictEqual(cloudrun?.tags, ['N/A']);
    assert.strictEqual(cloudrun?.owner, 'N/A');
    assert.strictEqual(cloudrun?.packageName, 'N/A');
    assert.strictEqual(cloudrun?.version, 'N/A');
    assert.strictEqual(cloudrun?.installs, 1);
    assert.strictEqual(isOfficialProvider(cloudrun?.owner), false);
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
    assert.strictEqual(details?.installs, 3);
    assert.strictEqual(details?.updates, 1);
    assert.strictEqual(details?.total, 4);
    assert.strictEqual(details?.lastInstalledAt, '2026-09-08T13:36:35.173Z');
  } finally {
    restore();
  }
});

test('test_getWorkflowDetails_should_return_null_when_workflow_does_not_exist', async () => {
  const details = await getWorkflowDetails('');
  assert.strictEqual(details, null);
});

test('test_getAllWorkflowTags_should_return_sorted_unique_tags_when_workflows_exist', () => {
  const tags = getAllWorkflowTags();
  assert.ok(Array.isArray(tags));
  assert.ok(tags.includes('lint'));
  assert.ok(tags.includes('automation'));
  assert.strictEqual(tags.includes('N/A'), false);
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
  assert.strictEqual(isOfficialProvider('N/A'), false);
});

test('test_local_workflows_should_all_have_official_owner', async () => {
  const result = await getTrendingWorkflows('');
  for (const workflow of result.workflows) {
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

test('test_fetchCatalog_should_return_null_when_endpoint_is_empty', async () => {
  const catalog = await fetchCatalog('');
  assert.strictEqual(catalog, null);
});

test('test_fetchCatalog_should_return_null_when_api_responds_with_error_status', async () => {
  const restore = mockFetch(async () => {
    return new Response(JSON.stringify({ error: 'internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const catalog = await fetchCatalog('https://api.example.com');
    assert.strictEqual(catalog, null);
  } finally {
    restore();
  }
});

test('test_fetchCatalog_should_return_null_when_api_responds_with_malformed_payload', async () => {
  const restore = mockFetch(async () => {
    return new Response(JSON.stringify({ invalid: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const catalog = await fetchCatalog('https://api.example.com');
    assert.strictEqual(catalog, null);
  } finally {
    restore();
  }
});

test('test_fetchCatalog_should_return_catalog_response_when_api_responds_successfully', async () => {
  const mockPayload = {
    total_workflows: 1,
    total_installations: 50,
    workflows: [
      {
        workflow_name: 'super-linter',
        title: 'Super-Linter Verified',
        description: 'Edge-cached linter workflow.',
        tags: ['lint', 'quality'],
        icon: 'fact_check',
        owner: 'ghwfxlab',
        version: '1.2.0',
        source_url: 'https://github.com/ghwfxlab/ghwm-registry',
        created_at: '2026-09-08T12:00:00.000Z',
        installs: 45,
        updates: 5,
        total: 50,
        last_installed_at: '2026-09-13T10:00:00.000Z',
      },
    ],
  };

  const restore = mockFetch(async (url) => {
    assert.ok(url.endsWith('/catalog'));
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const catalog = await fetchCatalog('https://api.example.com');
    assert.notStrictEqual(catalog, null);
    assert.strictEqual(catalog?.total_workflows, 1);
    assert.strictEqual(catalog?.total_installations, 50);
    assert.strictEqual(catalog?.workflows.length, 1);
    assert.strictEqual(catalog?.workflows[0].title, 'Super-Linter Verified');
  } finally {
    restore();
  }
});

test('test_fetchWorkflowDetails_should_return_details_from_workflows_endpoint', async () => {
  const mockPayload = {
    workflow_name: 'super-linter',
    title: 'Super-Linter Detail',
    description: 'Detailed description from edge API.',
    tags: ['lint', 'actions'],
    icon: 'fact_check',
    owner: 'ghwfxlab',
    version: '1.2.1',
    source_url: 'https://github.com/ghwfxlab/ghwm-registry',
    created_at: '2026-09-08T12:00:00.000Z',
    installs: 60,
    updates: 10,
    total: 70,
    last_installed_at: '2026-09-14T08:00:00.000Z',
  };

  const restore = mockFetch(async (url) => {
    assert.ok(url.includes('/workflows/super-linter'));
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const details = await fetchWorkflowDetails('super-linter', 'https://api.example.com');
    assert.notStrictEqual(details, null);
    assert.strictEqual(details?.workflow_name, 'super-linter');
    assert.strictEqual(details?.title, 'Super-Linter Detail');
    assert.strictEqual(details?.installs, 60);
    assert.strictEqual(details?.total, 70);
  } finally {
    restore();
  }
});

test('test_fetchWorkflowDetails_should_fallback_to_stats_endpoint_when_workflow_details_404', async () => {
  const mockStatsPayload = {
    workflow_name: 'super-linter',
    installs: 15,
    updates: 2,
    total: 17,
    last_installed_at: '2026-09-14T08:00:00.000Z',
  };

  const restore = mockFetch(async (url) => {
    if (url.endsWith('/stats')) {
      return new Response(JSON.stringify(mockStatsPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const details = await fetchWorkflowDetails('super-linter', 'https://api.example.com');
    assert.notStrictEqual(details, null);
    assert.strictEqual(details?.workflow_name, 'super-linter');
    assert.strictEqual(details?.installs, 15);
  } finally {
    restore();
  }
});

test('test_getTrendingWorkflows_should_prefer_catalog_endpoint_and_use_api_metadata_fields', async () => {
  const mockCatalog = {
    total_workflows: 1,
    total_installations: 88,
    workflows: [
      {
        workflow_name: 'cloudrun-docker',
        title: 'Deploy to Cloud Run',
        description: 'Continuous deployment to Google Cloud Run containers.',
        tags: ['gcp', 'cloudrun', 'docker'],
        icon: 'cloud_upload',
        owner: 'google-community',
        version: '2.5.0',
        source_url: 'https://github.com/google-community/cloudrun-workflow',
        created_at: '2026-08-15T00:00:00.000Z',
        installs: 80,
        updates: 8,
        total: 88,
        last_installed_at: '2026-09-14T09:00:00.000Z',
      },
    ],
  };

  const restore = mockFetch(async (url) => {
    assert.ok(url.endsWith('/catalog'));
    return new Response(JSON.stringify(mockCatalog), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const result = await getTrendingWorkflows('https://api.example.com');
    assert.strictEqual(result.isConnected, true);
    assert.strictEqual(result.totalInstallations, 88);
    assert.strictEqual(result.workflows.length, 1);

    const wf = result.workflows[0];
    assert.strictEqual(wf.name, 'cloudrun-docker');
    assert.strictEqual(wf.title, 'Deploy to Cloud Run');
    assert.strictEqual(wf.description, 'Continuous deployment to Google Cloud Run containers.');
    assert.deepStrictEqual(wf.tags, ['gcp', 'cloudrun', 'docker']);
    assert.strictEqual(wf.icon, 'cloud_upload');
    assert.strictEqual(wf.owner, 'google-community');
    assert.strictEqual(wf.version, '2.5.0');
    assert.strictEqual(wf.sourceUrl, 'https://github.com/google-community/cloudrun-workflow');
    assert.strictEqual(wf.createdAt, '2026-08-15T00:00:00.000Z');
    assert.strictEqual(wf.installs, 80);
    assert.strictEqual(wf.updates, 8);
    assert.strictEqual(wf.total, 88);
  } finally {
    restore();
  }
});

test('test_getTrendingWorkflows_should_fallback_to_stats_when_catalog_endpoint_fails', async () => {
  const mockStats = {
    source: null,
    total_installations: 20,
    workflows: [
      {
        workflow_name: 'super-linter',
        installs: 20,
        updates: 0,
        total: 20,
        last_installed_at: '2026-09-08T13:36:35.173Z',
      },
    ],
  };

  const restore = mockFetch(async (url) => {
    if (url.endsWith('/catalog')) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/stats')) {
      return new Response(JSON.stringify(mockStats), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  });

  try {
    const result = await getTrendingWorkflows('https://api.example.com');
    assert.strictEqual(result.isConnected, true);
    assert.strictEqual(result.totalInstallations, 20);
    assert.strictEqual(result.workflows.length, 1);
    assert.strictEqual(result.workflows[0].name, 'super-linter');
    assert.strictEqual(result.workflows[0].installs, 20);
  } finally {
    restore();
  }
});

test('test_getWorkflowDetails_should_override_NA_metadata_with_api_fields', async () => {
  const mockDetails = {
    workflow_name: 'external-custom-action',
    title: 'Custom Action Workflow',
    description: 'Third-party workflow hosted on community registry.',
    tags: ['deployment', 'production'],
    icon: 'rocket_launch',
    owner: 'acme-corp',
    version: '3.0.0',
    source_url: 'https://github.com/acme-corp/workflows',
    created_at: '2026-09-01T00:00:00.000Z',
    installs: 150,
    updates: 25,
    total: 175,
    last_installed_at: '2026-09-14T07:00:00.000Z',
  };

  const restore = mockFetch(async (url) => {
    assert.ok(url.includes('/workflows/external-custom-action'));
    return new Response(JSON.stringify(mockDetails), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const details = await getWorkflowDetails('external-custom-action', 'https://api.example.com');
    assert.notStrictEqual(details, null);
    assert.strictEqual(details?.name, 'external-custom-action');
    assert.strictEqual(details?.title, 'Custom Action Workflow');
    assert.strictEqual(details?.description, 'Third-party workflow hosted on community registry.');
    assert.deepStrictEqual(details?.tags, ['deployment', 'production']);
    assert.strictEqual(details?.icon, 'rocket_launch');
    assert.strictEqual(details?.owner, 'acme-corp');
    assert.strictEqual(details?.version, '3.0.0');
    assert.strictEqual(details?.sourceUrl, 'https://github.com/acme-corp/workflows');
    assert.strictEqual(details?.createdAt, '2026-09-01T00:00:00.000Z');
    assert.strictEqual(details?.installs, 150);
  } finally {
    restore();
  }
});

test('test_syncWorkflowCatalog_should_return_null_when_endpoint_or_token_is_missing', async () => {
  assert.strictEqual(await syncWorkflowCatalog('', 'valid-token', []), null);
  assert.strictEqual(await syncWorkflowCatalog('https://api.example.com', '', []), null);
});

test('test_syncWorkflowCatalog_should_send_bearer_token_and_workflows_payload', async () => {
  let capturedAuthHeader = null;
  let capturedBody = null;

  const restore = mockFetch(async (url, init) => {
    assert.ok(url.endsWith('/catalog/sync'));
    assert.strictEqual(init?.method, 'POST');
    capturedAuthHeader = init?.headers?.Authorization || null;
    capturedBody = JSON.parse(init?.body);

    return new Response(JSON.stringify({ status: 'synced', count: 2 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const sampleWorkflows = [
      { workflow_name: 'super-linter', title: 'Super-Linter' },
      { workflow_name: 'auto-assign-pr', title: 'Auto Assign PR' },
    ];

    const result = await syncWorkflowCatalog(
      'https://api.example.com',
      'secret-worker-token-xyz',
      sampleWorkflows
    );

    assert.notStrictEqual(result, null);
    assert.strictEqual(result?.status, 'synced');
    assert.strictEqual(result?.count, 2);
    assert.strictEqual(capturedAuthHeader, 'Bearer secret-worker-token-xyz');
    assert.strictEqual(capturedBody?.workflows?.length, 2);
    assert.strictEqual(capturedBody?.workflows[0]?.workflow_name, 'super-linter');
  } finally {
    restore();
  }
});

test('test_syncWorkflowCatalog_should_return_null_when_api_responds_with_unauthorized', async () => {
  const restore = mockFetch(async () => {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const result = await syncWorkflowCatalog('https://api.example.com', 'bad-token', []);
    assert.strictEqual(result, null);
  } finally {
    restore();
  }
});

test('test_sync_catalog_script_should_exit_zero_with_notice_when_token_is_missing', () => {
  const output = execFileSync('node', ['../../../scripts/sync-catalog.mjs'], {
    cwd: import.meta.dirname,
    encoding: 'utf-8',
    env: { ...process.env, WORKER_AUTH_TOKEN: '', AUTH_TOKEN: '' },
  });
  assert.ok(output.includes('Notice: WORKER_AUTH_TOKEN not set; skipping catalog synchronization.'));
});

test('test_sync_catalog_script_should_exit_one_when_strict_flag_and_token_is_missing', () => {
  assert.throws(
    () => {
      execFileSync('node', ['../../../scripts/sync-catalog.mjs', '--strict'], {
        cwd: import.meta.dirname,
        encoding: 'utf-8',
        env: { ...process.env, WORKER_AUTH_TOKEN: '', AUTH_TOKEN: '' },
      });
    },
    (err) => {
      return err.status === 1;
    }
  );
});


