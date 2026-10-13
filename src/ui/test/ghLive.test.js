import test from 'node:test';
import assert from 'node:assert';
import { fetchWorkflowLive, fetchRegistryLive } from '../src/lib/ghLive.ts';

const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const text = (body, status = 200) => ({ ok: status < 400, status, text: async () => body });

function memStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
}

const YAML = '# ---\n# title: Super Linter\n# tags:\n#   - lint\n# owner: ghwfxlab\n# ---\nname: x\n';

test('test_fetchWorkflowLive_should_use_worker_when_it_responds', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return json({ name: 'super-linter', version: '1.2.0', tags: ['lint'] });
  };
  const live = await fetchWorkflowLive('super-linter', { endpoint: 'https://w.example/', fetchImpl, storage: null });
  assert.strictEqual(live.version, '1.2.0');
  assert.deepStrictEqual(calls, ['https://w.example/live/super-linter']);
});

test('test_fetchWorkflowLive_should_fall_back_to_raw_github_when_worker_fails', async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith('https://w.example')) throw new Error('down');
    if (url.endsWith('package.json')) return text(JSON.stringify({ version: '1.3.0', description: 'pkg desc' }));
    return text(YAML);
  };
  const live = await fetchWorkflowLive('super-linter', { endpoint: 'https://w.example', fetchImpl, storage: null });
  assert.strictEqual(live.version, '1.3.0');
  assert.strictEqual(live.title, 'Super Linter');
  assert.strictEqual(live.description, 'pkg desc');
  assert.deepStrictEqual(live.tags, ['lint']);
});

test('test_fetchWorkflowLive_should_return_null_when_everything_fails', async () => {
  const fetchImpl = async () => text('nope', 404);
  assert.strictEqual(await fetchWorkflowLive('x', { endpoint: 'https://w.example', fetchImpl, storage: null }), null);
});

test('test_fetchWorkflowLive_should_return_null_on_malformed_worker_payload_and_no_raw', async () => {
  const fetchImpl = async (url) => (url.startsWith('https://w.example') ? text('{not json') : text('', 404));
  assert.strictEqual(await fetchWorkflowLive('x', { endpoint: 'https://w.example', fetchImpl, storage: null }), null);
});

test('test_fetchWorkflowLive_should_abort_on_timeout', async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  const live = await fetchWorkflowLive('x', { fetchImpl, timeoutMs: 20, storage: null });
  assert.strictEqual(live, null);
  assert.ok(Date.now() - started < 1000);
});

test('test_fetchWorkflowLive_should_serve_from_cache_within_ttl', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return json({ name: 'a', version: '1.0.0' });
  };
  const storage = memStorage();
  let t = 1000;
  const opts = { endpoint: 'https://w.example', fetchImpl, storage, ttlMs: 100, now: () => t };
  await fetchWorkflowLive('a', opts);
  await fetchWorkflowLive('a', opts);
  assert.strictEqual(n, 1);
  t += 200;
  await fetchWorkflowLive('a', opts);
  assert.strictEqual(n, 2);
});

test('test_fetchRegistryLive_should_use_worker_list_and_drop_invalid_items', async () => {
  const fetchImpl = async () => json({ workflows: [{ name: 'a', version: '1.0.0' }, { nope: true }, null] });
  const live = await fetchRegistryLive({ endpoint: 'https://w.example', fetchImpl, storage: null });
  assert.deepStrictEqual(live.map((w) => w.name), ['a']);
});

test('test_fetchRegistryLive_should_fall_back_to_github_listing_when_worker_unavailable', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/contents/workflows')) return json([{ name: 'a', type: 'dir' }, { name: 'README.md', type: 'file' }]);
    if (url.endsWith('package.json')) return text(JSON.stringify({ version: '2.0.0' }));
    return text(YAML);
  };
  const live = await fetchRegistryLive({ fetchImpl, storage: null });
  assert.strictEqual(live.length, 1);
  assert.strictEqual(live[0].name, 'a');
  assert.strictEqual(live[0].version, '2.0.0');
});
