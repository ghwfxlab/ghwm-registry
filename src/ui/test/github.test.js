import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchLatestGhwmTag,
  getInstallCommands,
  fetchLatestGhwmVersion,
  parsePypiVersion,
  getGitHubToken,
  isValidCliTag,
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

test('test_getInstallCommands_should_pin_the_given_version', () => {
  // Act
  const commands = getInstallCommands('1.10.0');

  // Assert
  assert.deepStrictEqual(commands, {
    uv: 'uv tool install ghwm',
    'uv-pinned': 'uv tool install ghwm==1.10.0',
    pipx: 'pipx install ghwm',
    pip: 'pip install ghwm',
  });
});

test('test_getInstallCommands_should_fall_back_to_unpinned_when_version_unknown', () => {
  // Act / Assert
  assert.strictEqual(getInstallCommands(null)['uv-pinned'], 'uv tool install ghwm');
  assert.strictEqual(getInstallCommands()['uv-pinned'], 'uv tool install ghwm');
});

test('test_parsePypiVersion_should_accept_release_versions_only', () => {
  assert.strictEqual(parsePypiVersion({ info: { version: ' 1.10.0 ' } }), '1.10.0');
  assert.strictEqual(parsePypiVersion({ info: { version: '2.0.0rc1' } }), null);
  assert.strictEqual(parsePypiVersion({ info: { version: 'x; rm -rf /' } }), null);
  assert.strictEqual(parsePypiVersion({}), null);
  assert.strictEqual(parsePypiVersion(null), null);
});

test('test_fetchLatestGhwmVersion_should_return_the_version_published_on_pypi', async () => {
  // Arrange
  let requested = '';
  const fetchFn = async (url) => {
    requested = url.toString();
    return { ok: true, json: async () => ({ info: { version: '1.11.0' } }) };
  };

  // Act
  const version = await fetchLatestGhwmVersion({ fetchFn });

  // Assert
  assert.strictEqual(requested, 'https://pypi.org/pypi/ghwm/json');
  assert.strictEqual(version, '1.11.0');
});

test('test_fetchLatestGhwmVersion_should_return_null_when_pypi_fails', async () => {
  // Arrange
  const failing = async () => {
    throw new Error('offline');
  };
  const notFound = async () => ({ ok: false, status: 404 });

  // Act / Assert
  assert.strictEqual(await fetchLatestGhwmVersion({ fetchFn: failing }), null);
  assert.strictEqual(await fetchLatestGhwmVersion({ fetchFn: notFound }), null);
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

test('test_fetchLatestGhwmTag_should_return_tag_name_when_releases_succeeds', async () => {
  // Arrange
  let capturedHeaders = null;
  const restore = mockFetch(async (url, init) => {
    if (url.includes('/releases')) {
      capturedHeaders = init?.headers;
      return {
        ok: true,
        status: 200,
        json: async () => [{ tag_name: 'v1.4.0' }],
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

test('test_fetchLatestGhwmTag_should_support_single_object_release_response', async () => {
  // Arrange
  const restore = mockFetch(async (url) => {
    if (url.includes('/releases')) {
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
    const tag = await fetchLatestGhwmTag();

    // Assert
    assert.strictEqual(tag, 'v1.4.0');
  } finally {
    restore();
  }
});

test('test_fetchLatestGhwmTag_should_fallback_to_tags_when_releases_returns_404', async () => {
  // Arrange
  const restore = mockFetch(async (url) => {
    if (url.includes('/releases')) {
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

test('test_fetchLatestGhwmTag_should_return_fallback_immediately_on_403_rate_limit', async () => {
  // Arrange
  let calls = 0;
  const restore = mockFetch(async (url) => {
    calls++;
    if (url.includes('/releases')) {
      return { ok: false, status: 403 };
    }
    return { ok: true, status: 200, json: async () => [{ name: 'v9.9.9' }] };
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag({ fallbackTag: 'v1.4.0-fallback' });

    // Assert: should return fallback immediately and NOT make a second request to /tags
    assert.strictEqual(tag, 'v1.4.0-fallback');
    assert.strictEqual(calls, 1);
  } finally {
    restore();
  }
});

test('test_fetchLatestGhwmTag_should_return_fallback_when_tags_returns_403', async () => {
  // Arrange
  const restore = mockFetch(async (url) => {
    if (url.includes('/releases')) {
      return { ok: false, status: 404 };
    }
    if (url.includes('/tags')) {
      return { ok: false, status: 403 };
    }
    return { ok: false, status: 404 };
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag({ fallbackTag: 'v1.4.0-fallback' });

    // Assert
    assert.strictEqual(tag, 'v1.4.0-fallback');
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
      json: async () => [{ tag_name: '@v2.1.0' }],
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

test('test_isValidCliTag_should_validate_cli_tags_and_reject_ui_tags', () => {
  assert.strictEqual(isValidCliTag('v1.4.0'), true);
  assert.strictEqual(isValidCliTag('v0.1.0'), true);
  assert.strictEqual(isValidCliTag('1.4.0'), true);
  assert.strictEqual(isValidCliTag('v2.0.0-rc.1'), true);

  assert.strictEqual(isValidCliTag('ui-v0.0.1'), false);
  assert.strictEqual(isValidCliTag('registry-v1.0.0'), false);
  assert.strictEqual(isValidCliTag(''), false);
  assert.strictEqual(isValidCliTag(null), false);
  assert.strictEqual(isValidCliTag(undefined), false);
});

test('test_fetchLatestGhwmTag_should_skip_ui_tags_and_return_latest_cli_release', async () => {
  // Arrange
  const restore = mockFetch(async (url) => {
    if (url.includes('/releases')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { tag_name: 'ui-v0.0.1' },
          { tag_name: 'v1.4.0' },
          { tag_name: 'v1.3.0' },
        ],
      };
    }
    return { ok: false, status: 404 };
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag();

    // Assert
    assert.strictEqual(tag, 'v1.4.0');
  } finally {
    restore();
  }
});

test('test_fetchLatestGhwmTag_should_skip_ui_tags_in_tags_fallback', async () => {
  // Arrange
  const restore = mockFetch(async (url) => {
    if (url.includes('/releases')) {
      return { ok: false, status: 404 };
    }
    if (url.includes('/tags')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { name: 'ui-v0.0.1' },
          { name: 'v1.4.0' },
        ],
      };
    }
    return { ok: false, status: 404 };
  });

  try {
    // Act
    const tag = await fetchLatestGhwmTag();

    // Assert
    assert.strictEqual(tag, 'v1.4.0');
  } finally {
    restore();
  }
});

