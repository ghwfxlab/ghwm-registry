import test from 'node:test';
import assert from 'node:assert';
import { fetchWorkflowDetailsLive, fetchCatalogLive, formatRelativeTime } from '../src/lib/liveApi.ts';

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function memStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}

test('test_fetchWorkflowDetailsLive_should_read_workflow_from_worker_and_drop_NA_values', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return json({
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
  const live = await fetchWorkflowDetailsLive('https://w.example/', 'super-linter', { fetchImpl, storage: null });
  assert.deepStrictEqual(calls, ['https://w.example/workflows/super-linter']);
  assert.strictEqual(live.version, '1.3.0');
  assert.strictEqual(live.description, null);
  assert.deepStrictEqual(live.tags, ['lint']);
  assert.strictEqual(live.installs, 4);
  assert.strictEqual(live.metadata_refreshed_at, '2026-10-13T12:00:00.000Z');
});

test('test_fetchWorkflowDetailsLive_should_return_null_on_error_status_malformed_payload_or_missing_endpoint', async () => {
  assert.strictEqual(
    await fetchWorkflowDetailsLive('https://w.example', 'x', { fetchImpl: async () => json({}, 404), storage: null }),
    null,
  );
  assert.strictEqual(
    await fetchWorkflowDetailsLive('https://w.example', 'x', { fetchImpl: async () => json({ nope: 1 }), storage: null }),
    null,
  );
  assert.strictEqual(
    await fetchWorkflowDetailsLive('https://w.example', 'x', {
      fetchImpl: async () => {
        throw new Error('offline');
      },
      storage: null,
    }),
    null,
  );
  assert.strictEqual(await fetchWorkflowDetailsLive('', 'x', { storage: null }), null);
});

test('test_fetchWorkflowDetailsLive_should_abort_on_timeout', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  assert.strictEqual(await fetchWorkflowDetailsLive('https://w.example', 'x', { fetchImpl, timeoutMs: 20, storage: null }), null);
  assert.ok(Date.now() - started < 1000);
});

test('test_fetchWorkflowDetailsLive_should_cache_within_ttl_and_bypass_cache_when_fresh', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return json({ workflow_name: 'a', version: '1.0.0' });
  };
  const storage = memStorage();
  let t = 1000;
  const opts = { fetchImpl, storage, ttlMs: 100, now: () => t };
  await fetchWorkflowDetailsLive('https://w.example', 'a', opts);
  await fetchWorkflowDetailsLive('https://w.example', 'a', opts);
  assert.strictEqual(n, 1);
  await fetchWorkflowDetailsLive('https://w.example', 'a', { ...opts, fresh: true });
  assert.strictEqual(n, 2);
  t += 200;
  await fetchWorkflowDetailsLive('https://w.example', 'a', opts);
  assert.strictEqual(n, 3);
});

test('test_fetchCatalogLive_should_normalize_rows_and_skip_invalid_entries', async () => {
  const fetchImpl = async (url) => {
    assert.strictEqual(url, 'https://w.example/catalog');
    return json({
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
        { workflow_name: 'third-party', title: 'N/A', tags: [], installs: 'x' },
        { nope: true },
        null,
      ],
    });
  };
  const rows = await fetchCatalogLive('https://w.example', { fetchImpl, storage: null });
  assert.deepStrictEqual(rows.map((r) => r.name), ['super-linter', 'third-party']);
  assert.strictEqual(rows[0].version, '1.3.0');
  assert.strictEqual(rows[0].description, undefined);
  assert.strictEqual(rows[0].total, 12);
  assert.match(rows[0].addedFormatted, /2026/);
  assert.strictEqual(rows[0].lastActiveFormatted, 'None recorded');
  assert.strictEqual(rows[1].title, undefined);
  assert.strictEqual(rows[1].tags, undefined);
  assert.strictEqual(rows[1].installs, 0);
  assert.strictEqual(rows[1].addedFormatted, 'Unknown');
});

test('test_fetchCatalogLive_should_return_null_when_worker_unavailable_or_payload_malformed', async () => {
  assert.strictEqual(await fetchCatalogLive('https://w.example', { fetchImpl: async () => json({}, 500), storage: null }), null);
  assert.strictEqual(await fetchCatalogLive('https://w.example', { fetchImpl: async () => json({ workflows: 3 }), storage: null }), null);
  assert.strictEqual(await fetchCatalogLive('', { storage: null }), null);
});

test('test_formatRelativeTime_should_describe_elapsed_time', () => {
  const now = Date.parse('2026-10-13T12:00:00.000Z');
  assert.strictEqual(formatRelativeTime('2026-10-13T11:59:50.000Z', now), 'just now');
  assert.strictEqual(formatRelativeTime('2026-10-13T11:55:00.000Z', now), '5 min ago');
  assert.strictEqual(formatRelativeTime('2026-10-13T09:00:00.000Z', now), '3 h ago');
  assert.strictEqual(formatRelativeTime('2026-10-11T12:00:00.000Z', now), '2 d ago');
  assert.strictEqual(formatRelativeTime(null, now), null);
  assert.strictEqual(formatRelativeTime('garbage', now), null);
});
