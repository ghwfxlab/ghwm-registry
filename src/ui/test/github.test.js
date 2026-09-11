import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchLatestGhwmTag,
  getInstallCommands,
  getGitHubToken,
  DEFAULT_GHWM_REPO,
  DEFAULT_GHWM_TAG,
} from '../src/lib/github.ts';

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

test('test_getInstallCommands_should_generate_commands_with_default_tag_and_repo', () => {
  // Act
  const commands = getInstallCommands();

  // Assert
  assert.strictEqual(
    commands['uv-pinned'],
    `uv tool install git+https://github.com/${DEFAULT_GHWM_REPO}.git@${DEFAULT_GHWM_TAG}`
  );
  assert.strictEqual(
    commands['uv'],
    `uv tool install git+https://github.com/${DEFAULT_GHWM_REPO}.git`
  );
  assert.strictEqual(
    commands['pipx'],
    `pipx install git+https://github.com/${DEFAULT_GHWM_REPO}.git`
  );
  assert.strictEqual(
    commands['pip'],
    `pip install git+https://github.com/${DEFAULT_GHWM_REPO}.git`
  );
});

test('test_getInstallCommands_should_support_custom_tag_and_strip_leading_at', () => {
  // Act
  const commands = getInstallCommands('@v2.0.0', 'custom-org/my-tool');

  // Assert
  assert.strictEqual(
    commands['uv-pinned'],
    'uv tool install git+https://github.com/custom-org/my-tool.git@v2.0.0'
  );
  assert.strictEqual(
    commands['uv'],
    'uv tool install git+https://github.com/custom-org/my-tool.git'
  );
});

test('test_getInstallCommands_should_fallback_to_default_tag_when_empty_string_provided', () => {
  // Act
  const commands = getInstallCommands('');

  // Assert
  assert.strictEqual(
    commands['uv-pinned'],
    `uv tool install git+https://github.com/${DEFAULT_GHWM_REPO}.git@${DEFAULT_GHWM_TAG}`
  );
});

test('test_getGitHubToken_should_read_from_process_env', () => {
  // Arrange
  const origToken = process.env.GITHUB_TOKEN;
  const origGhToken = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;

  try {
    assert.strictEqual(getGitHubToken(), undefined);

    process.env.GITHUB_TOKEN = 'ghp_secret123';
    assert.strictEqual(getGitHubToken(), 'ghp_secret123');
  } finally {
    if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
    else delete process.env.GITHUB_TOKEN;
    if (origGhToken !== undefined) process.env.GH_TOKEN = origGhToken;
    else delete process.env.GH_TOKEN;
  }
});

test('test_fetchLatestGhwmTag_should_return_tag_name_when_releases_latest_succeeds', async () => {
  // Arrange
  let capturedHeaders = null;
  const restore = mockFetch(async (url, init) => {
    if (url.includes('/releases/latest')) {
      capturedHeaders = init?.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ tag_name: 'v1.4.0' }),
      };
    }
    return { ok: false, status: 404 };
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag({ token: 'test-token' });

    // Assert
    assert.strictEqual(tag, 'v1.4.0');
    assert.strictEqual(capturedHeaders?.['User-Agent'], 'ghwm-registry');
    assert.strictEqual(capturedHeaders?.['Authorization'], 'Bearer test-token');
  } finally {
    restore();
  }
});

test('test_fetchLatestGhwmTag_should_fallback_to_tags_when_releases_latest_returns_404', async () => {
  // Arrange
  const restore = mockFetch(async (url) => {
    if (url.includes('/releases/latest')) {
      return { ok: false, status: 404 };
    }
    if (url.includes('/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => [{ name: 'v1.3.5' }],
      };
    }
    return { ok: false, status: 404 };
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag();

    // Assert
    assert.strictEqual(tag, 'v1.3.5');
  } finally {
    restore();
  }
});

test('test_fetchLatestGhwmTag_should_return_fallback_when_both_release_and_tags_fail', async () => {
  // Arrange
  const restore = mockFetch(async () => {
    return { ok: false, status: 500 };
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag({ fallbackTag: 'v1.0.0-fallback' });

    // Assert
    assert.strictEqual(tag, 'v1.0.0-fallback');
  } finally {
    restore();
  }
});

test('test_fetchLatestGhwmTag_should_return_fallback_when_network_error_occurs', async () => {
  // Arrange
  const restore = mockFetch(async () => {
    throw new Error('Network offline or DNS failure');
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag({ fallbackTag: 'v1.0.0-offline' });

    // Assert
    assert.strictEqual(tag, 'v1.0.0-offline');
  } finally {
    restore();
  }
});

test('test_fetchLatestGhwmTag_should_strip_leading_at_symbol_from_tag_name', async () => {
  // Arrange
  const restore = mockFetch(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ tag_name: '@v2.1.0' }),
    };
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag();

    // Assert
    assert.strictEqual(tag, 'v2.1.0');
  } finally {
    restore();
  }
});
