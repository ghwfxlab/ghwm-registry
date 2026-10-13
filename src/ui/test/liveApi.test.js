import test from 'node:test';
import assert from 'node:assert';
import { fetchWorkflowDetailsLive, fetchCatalogLive, formatRelativeTime } from '../src/lib/liveApi.ts';

const WORKER_URL = 'https://worker.example';

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function createMemoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
}

test('test_fetchWorkflowDetailsLive_should_read_the_workflow_and_drop_NA_values_when_the_worker_responds', async () => {
  // Arrange
  const requestedUrls = [];
  const fetchImpl = async (url) => {
    requestedUrls.push(url);
    return jsonResponse({
      workflow_name: 'super-linter',
      title: 'Super Linter',
      description: 'N/A',
      tags: ['lint', 'N/A', 7],
      version: '1.3.0',
      installs: '4',
      updates: 1,
      metadata_refreshed_at: '2026-10-13T12:00:00.000Z',
    });
  };

  // Act
  const details = await fetchWorkflowDetailsLive(`${WORKER_URL}/`, 'super-linter', { fetchImpl, storage: null });

  // Assert
  assert.deepStrictEqual(requestedUrls, [`${WORKER_URL}/workflows/super-linter`]);
  assert.strictEqual(details.version, '1.3.0');
  assert.strictEqual(details.description, null);
  assert.deepStrictEqual(details.tags, ['lint']);
  assert.strictEqual(details.installs, 4);
  assert.strictEqual(details.metadata_refreshed_at, '2026-10-13T12:00:00.000Z');
});

test('test_fetchWorkflowDetailsLive_should_return_null_when_the_worker_answers_with_an_error_status', async () => {
  // Arrange
  const fetchImpl = async () => jsonResponse({}, 404);

  // Act
  const details = await fetchWorkflowDetailsLive(WORKER_URL, 'unknown-workflow', { fetchImpl, storage: null });

  // Assert
  assert.strictEqual(details, null);
});

test('test_fetchWorkflowDetailsLive_should_return_null_when_the_payload_is_malformed', async () => {
  // Arrange
  const fetchImpl = async () => jsonResponse({ unexpected: true });

  // Act
  const details = await fetchWorkflowDetailsLive(WORKER_URL, 'super-linter', { fetchImpl, storage: null });

  // Assert
  assert.strictEqual(details, null);
});

test('test_fetchWorkflowDetailsLive_should_return_null_when_the_network_request_fails', async () => {
  // Arrange
  const fetchImpl = async () => {
    throw new Error('offline');
  };

  // Act
  const details = await fetchWorkflowDetailsLive(WORKER_URL, 'super-linter', { fetchImpl, storage: null });

  // Assert
  assert.strictEqual(details, null);
});

test('test_fetchWorkflowDetailsLive_should_return_null_without_calling_the_network_when_no_endpoint_is_configured', async () => {
  // Arrange
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount++;
    return jsonResponse({});
  };

  // Act
  const details = await fetchWorkflowDetailsLive('', 'super-linter', { fetchImpl, storage: null });

  // Assert
  assert.strictEqual(details, null);
  assert.strictEqual(requestCount, 0);
});

test('test_fetchWorkflowDetailsLive_should_abort_and_return_null_when_the_request_exceeds_the_timeout', async () => {
  // Arrange
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const startedAtMs = Date.now();

  // Act
  const details = await fetchWorkflowDetailsLive(WORKER_URL, 'super-linter', {
    fetchImpl,
    timeoutMs: 20,
    storage: null,
  });

  // Assert
  assert.strictEqual(details, null);
  assert.ok(Date.now() - startedAtMs < 1000);
});

test('test_fetchWorkflowDetailsLive_should_serve_from_cache_when_the_entry_is_within_the_ttl', async () => {
  // Arrange
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount++;
    return jsonResponse({ workflow_name: 'auto-release', version: '1.0.0' });
  };
  const options = { fetchImpl, storage: createMemoryStorage(), ttlMs: 100, now: () => 1000 };

  // Act
  await fetchWorkflowDetailsLive(WORKER_URL, 'auto-release', options);
  await fetchWorkflowDetailsLive(WORKER_URL, 'auto-release', options);

  // Assert
  assert.strictEqual(requestCount, 1);
});

test('test_fetchWorkflowDetailsLive_should_bypass_the_cache_when_fresh_is_requested', async () => {
  // Arrange
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount++;
    return jsonResponse({ workflow_name: 'auto-release', version: '1.0.0' });
  };
  const options = { fetchImpl, storage: createMemoryStorage(), ttlMs: 100, now: () => 1000 };
  await fetchWorkflowDetailsLive(WORKER_URL, 'auto-release', options);

  // Act
  await fetchWorkflowDetailsLive(WORKER_URL, 'auto-release', { ...options, fresh: true });

  // Assert
  assert.strictEqual(requestCount, 2);
});

test('test_fetchWorkflowDetailsLive_should_request_again_when_the_cache_entry_is_older_than_the_ttl', async () => {
  // Arrange
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount++;
    return jsonResponse({ workflow_name: 'auto-release', version: '1.0.0' });
  };
  let currentTimeMs = 1000;
  const options = { fetchImpl, storage: createMemoryStorage(), ttlMs: 100, now: () => currentTimeMs };
  await fetchWorkflowDetailsLive(WORKER_URL, 'auto-release', options);

  // Act
  currentTimeMs += 200;
  await fetchWorkflowDetailsLive(WORKER_URL, 'auto-release', options);

  // Assert
  assert.strictEqual(requestCount, 2);
});

test('test_fetchCatalogLive_should_normalize_rows_and_skip_invalid_entries_when_the_catalog_contains_mixed_data', async () => {
  // Arrange
  const fetchImpl = async (url) => {
    assert.strictEqual(url, `${WORKER_URL}/catalog`);
    return jsonResponse({
      workflows: [
        {
          workflow_name: 'super-linter',
          title: 'Super Linter',
          description: null,
          version: '1.3.0',
          tags: ['lint'],
          icon: 'fact_check',
          owner: 'ghwfxlab',
          installs: 10,
          updates: 2,
          total: 12,
          created_at: '2026-09-08T12:00:00.000Z',
          last_installed_at: null,
        },
        { workflow_name: 'third-party', title: 'N/A', tags: [], installs: 'not-a-number' },
        { unexpected: true },
        null,
      ],
    });
  };

  // Act
  const rows = await fetchCatalogLive(WORKER_URL, { fetchImpl, storage: null });

  // Assert
  assert.deepStrictEqual(rows.map((row) => row.name), ['super-linter', 'third-party']);
  const [superLinter, thirdParty] = rows;
  assert.strictEqual(superLinter.version, '1.3.0');
  assert.strictEqual(superLinter.description, undefined);
  assert.strictEqual(superLinter.total, 12);
  assert.match(superLinter.addedFormatted, /2026/);
  assert.strictEqual(superLinter.lastActiveFormatted, 'None recorded');
  assert.strictEqual(thirdParty.title, undefined);
  assert.strictEqual(thirdParty.tags, undefined);
  assert.strictEqual(thirdParty.installs, 0);
  assert.strictEqual(thirdParty.addedFormatted, 'Unknown');
});

test('test_fetchCatalogLive_should_return_null_when_the_worker_answers_with_an_error_status', async () => {
  // Arrange
  const fetchImpl = async () => jsonResponse({}, 500);

  // Act
  const rows = await fetchCatalogLive(WORKER_URL, { fetchImpl, storage: null });

  // Assert
  assert.strictEqual(rows, null);
});

test('test_fetchCatalogLive_should_return_null_when_the_payload_is_malformed', async () => {
  // Arrange
  const fetchImpl = async () => jsonResponse({ workflows: 3 });

  // Act
  const rows = await fetchCatalogLive(WORKER_URL, { fetchImpl, storage: null });

  // Assert
  assert.strictEqual(rows, null);
});

test('test_fetchCatalogLive_should_return_null_when_no_endpoint_is_configured', async () => {
  // Arrange
  const options = { storage: null };

  // Act
  const rows = await fetchCatalogLive('', options);

  // Assert
  assert.strictEqual(rows, null);
});

test('test_formatRelativeTime_should_describe_the_elapsed_time_when_a_valid_timestamp_is_given', () => {
  // Arrange
  const nowMs = Date.parse('2026-10-13T12:00:00.000Z');

  // Act
  const descriptions = [
    formatRelativeTime('2026-10-13T11:59:50.000Z', nowMs),
    formatRelativeTime('2026-10-13T11:55:00.000Z', nowMs),
    formatRelativeTime('2026-10-13T09:00:00.000Z', nowMs),
    formatRelativeTime('2026-10-11T12:00:00.000Z', nowMs),
  ];

  // Assert
  assert.deepStrictEqual(descriptions, ['just now', '5 min ago', '3 h ago', '2 d ago']);
});

test('test_formatRelativeTime_should_return_null_when_the_timestamp_is_missing_or_invalid', () => {
  // Arrange
  const nowMs = Date.parse('2026-10-13T12:00:00.000Z');

  // Act
  const missing = formatRelativeTime(null, nowMs);
  const invalid = formatRelativeTime('garbage', nowMs);

  // Assert
  assert.strictEqual(missing, null);
  assert.strictEqual(invalid, null);
});
