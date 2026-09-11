import test from 'node:test';
import assert from 'node:assert/strict';
import { withBase } from '../src/lib/paths.ts';

test('test_withBase_should_return_root_path_when_base_is_default', () => {
  const originalBase = process.env.ASTRO_BASE;
  delete process.env.ASTRO_BASE;

  try {
    assert.strictEqual(withBase('/'), '/');
    assert.strictEqual(withBase(''), '/');
    assert.strictEqual(withBase('/registry'), '/registry');
    assert.strictEqual(withBase('official'), '/official');
    assert.strictEqual(withBase('/workflows/super-linter'), '/workflows/super-linter');
    assert.strictEqual(withBase('/registry?sort=added_desc'), '/registry?sort=added_desc');
  } finally {
    if (originalBase !== undefined) process.env.ASTRO_BASE = originalBase;
  }
});

test('test_withBase_should_prepend_base_when_custom_base_is_configured', () => {
  const originalBase = process.env.ASTRO_BASE;
  process.env.ASTRO_BASE = '/ghwm';

  try {
    assert.strictEqual(withBase('/'), '/ghwm/');
    assert.strictEqual(withBase(''), '/ghwm/');
    assert.strictEqual(withBase('/registry'), '/ghwm/registry');
    assert.strictEqual(withBase('official'), '/ghwm/official');
    assert.strictEqual(withBase('/workflows/super-linter'), '/ghwm/workflows/super-linter');
    assert.strictEqual(withBase('/registry?sort=installs_desc'), '/ghwm/registry?sort=installs_desc');
    assert.strictEqual(withBase('/favicon.svg'), '/ghwm/favicon.svg');
  } finally {
    if (originalBase !== undefined) {
      process.env.ASTRO_BASE = originalBase;
    } else {
      delete process.env.ASTRO_BASE;
    }
  }
});

test('test_withBase_should_handle_trailing_slashes_in_configured_base', () => {
  const originalBase = process.env.ASTRO_BASE;
  process.env.ASTRO_BASE = '/ghwm///';

  try {
    assert.strictEqual(withBase('/'), '/ghwm/');
    assert.strictEqual(withBase('/registry'), '/ghwm/registry');
  } finally {
    if (originalBase !== undefined) {
      process.env.ASTRO_BASE = originalBase;
    } else {
      delete process.env.ASTRO_BASE;
    }
  }
});
