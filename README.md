# ghwm-registry

[![Lint Code Base](https://github.com/ghwfxlab/ghwm-registry/actions/workflows/linter.yaml/badge.svg)](https://github.com/ghwfxlab/ghwm-registry/actions/workflows/linter.yaml)

| ![GitHub Workflows Registry](.github/static/readme_header.png) |
| :---------------------------------------------------------------: |

> Curated GitHub Actions workflows published as npm packages and installed
> via the [`ghwm` CLI](https://github.com/ghwfxlab/ghwm).

## Repository Overview

This repository is a monorepo containing:

- **Curated Workflows (`workflows/`)**: Curated GitHub Actions workflows published as packages.
- **Astro UI (`src/ui/`)**: The marketplace site frontend built with Astro.
- **Scripts & Automations (`src/scripts/`)**: Scraper and backend automation scripts.

---

## Repository Setup

We use a `Makefile` at the root of the repository to manage tasks across different directories.

### Available Makefile Commands

- **Setup Dependencies**: Install all package dependencies (Astro UI dependencies).

  ```bash
  make setup
  ```

- **Run Dev Server**: Run the Astro local development server.

  ```bash
  make dev
  # or explicitly target the live production API:
  make dev-prod-api
  ```

  To target the test API endpoint (`https://ghwm-deployment-tst.ghwfxlab.workers.dev`) for testing or development:

  ```bash
  make dev-test-api
  # or
  make dev TARGET_API=test
  ```

- **Production Build**: Build static assets for production deployment targeting the live production API (`https://ghwm-deployment-prd.ghwfxlab.workers.dev`).

  ```bash
  make build
  # or explicitly target the production API:
  make build-prod-api
  # or target the test API endpoint:
  make build-test-api
  # or
  make build TARGET_API=test
  ```

- **Preview Build**: Preview the built production assets locally.

  ```bash
  make preview
  ```

- **Run UI Tests**: Run unit tests for the UI usage and API integration.

  ```bash
  make ui-tests
  ```

- **Clean Project**: Clean up dependencies and build artifacts.

  ```bash
  make clean
  ```

---

## Available Workflows

| Workflow         | Description                                                                                                                                  | Docs                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `auto-assign-pr` | Automatically add pull-request reviewers and assignees using [kentaro-m/auto-assign-action](https://github.com/kentaro-m/auto-assign-action) | [Readme](workflows/auto-assign-pr/README.md) |
| `super-linter`   | Code linting using [Super-Linter](https://github.com/super-linter/super-linter) and pre-commit hooks                                         | [Readme](workflows/super-linter/README.md)   |

---

## Quick Start

### 1. Install the CLI

```sh
uv tool install git+https://github.com/ghwfxlab/ghwm.git
```

Or pin the CLI to a specific tag:

```sh
uv tool install git+https://github.com/ghwfxlab/ghwm.git@vX.Y.Z
```

### 2. Create `ghwm.yml` in your repository root

```yaml
source: ghwfxlab/ghwm-registry
workflows:
  - name: super-linter
    version: 1.0.0
  - name: auto-assign-pr
    version: 1.0.0
    update-triggers: true
    update-config-files: true
```

Optional per-workflow update controls in `ghwm.yml`:

- `update-triggers: true` — on workflow updates, replace the current `on:` section with the
  packaged triggers. By default, updates preserve the repository's existing trigger configuration.
- `update-config-files: true` — on workflow updates, replace packaged config files such as
  `.github/auto_assign.yaml`. By default, packaged config files are only created when missing.

In the example above, `auto-assign-pr` is configured to replace both the installed workflow triggers
and the packaged config file when you run `ghwm update`.

### 3. Install workflows

```sh
ghwm install
```

Commit the generated files:

- the installed workflow files under `.github/workflows/`
- `ghwm.lock`
- any workflow-specific config files created on first install (for example
  `.github/auto_assign.yaml`)

See the [ghwm readme](https://github.com/ghwfxlab/ghwm#readme) for full CLI
usage, authentication, and local development options.

Some workflows install extra repository files or require extra settings. See each workflow readme
for workflow-specific setup; for example, `auto-assign-pr` seeds `.github/auto_assign.yaml` on the
first install, expects you to review and commit it, and can update it later when
`update-config-files: true` is set. Workflow updates also preserve the existing `on:` section by
default; set `update-triggers: true` in `ghwm.yml` when you want the packaged triggers to
replace the current ones.

### 4. Update workflows

When a new package version is available, bump the version in `ghwm.yml`:

```diff
 source: ghwfxlab/ghwm-registry
 workflows:
   - name: super-linter
-    version: 1.0.0
+    version: 1.1.0
   - name: auto-assign-pr
     version: 1.0.0
     update-triggers: true
     update-config-files: true
```

Then run:

```sh
ghwm update
```

Use `ghwm update` when the workflow is still present in `ghwm.yml` and you want to
refresh it in place. If you also removed other workflows from the manifest, run
`ghwm update --prune` to refresh the remaining workflows and prune removed managed files in
the same command.

### 5. Remove workflows and prune managed files

To remove a workflow, delete its entry from `ghwm.yml`:

```diff
 source: ghwfxlab/ghwm-registry
 workflows:
-  - name: super-linter
-    version: 1.1.0
   - name: auto-assign-pr
     version: 1.0.0
     update-triggers: true
     update-config-files: true
```

Then run one of:

```sh
ghwm install         # full sync to the current manifest
ghwm update --prune  # refresh remaining workflows and prune removed managed files
```

Both commands prune managed workflow files for entries that are no longer listed in
`ghwm.yml` and rewrite `ghwm.lock` to match the remaining workflows.

### 6. Add the Renovate preset

Add this to `renovate.json` in the consumer repository:

```json
{
  "extends": ["github>ghwfxlab/ghwm-registry//renovate/default.json"]
}
```

The preset updates workflow package versions in `ghwm.yml`, including entries that contain
optional keys such as `target`, `update-triggers`, `update-config-files`, or quoted version values.

## Maintainers

For contributor and publishing guidance, see:

- [CONTRIBUTING.md](CONTRIBUTING.md) — adding, updating, validating, and publishing workflows
- [workflows/README.md](workflows/README.md) — package layout and workflow catalog
