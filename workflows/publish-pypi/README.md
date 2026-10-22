# Publish to PyPI Workflow

The `publish-pypi` workflow builds a Python package with [uv](https://docs.astral.sh/uv/) and
publishes it to PyPI when a release is published. It uses PyPI trusted publishing (OIDC), so no
API token is stored in the repository.

## Source of Truth

- Registry repository: [ghwfxlab/ghwm-registry](https://github.com/ghwfxlab/ghwm-registry)
- Workflow source: [`workflows/publish-pypi/publish-pypi.yaml`](./publish-pypi.yaml)

## What gets installed

After running `ghwm install`, the consumer repository gets:

- `.github/workflows/publish-pypi.yaml`
- An entry in `ghwm.lock`

## How it works

1. `build` checks out the release tag, runs `uv build`, and checks that the built files carry the
   release version, so a development build is never published. It uploads `dist/` as an artifact.
2. `publish` downloads `dist/` and uploads it to PyPI with
   [`pypa/gh-action-pypi-publish`](https://github.com/pypa/gh-action-pypi-publish).

Every action is pinned to a commit SHA. `ghwm audit` passes with no findings.

## Permissions

The workflow sets `permissions: {}` and grants each job only what it needs:

| Job | Permission | Level |
| --- | --- | --- |
| `build` | `contents` | `read` |
| `publish` | `id-token` | `write` |

## Consumer Setup

### 1. Install the workflow

```yaml
source: ghwfxlab/ghwm-registry
workflows:
  - name: publish-pypi
    version: 1.0.0
```

Then run `ghwm install`.

### 2. Configure trusted publishing on PyPI

In the PyPI project, open **Publishing** and add a trusted publisher with:

- Owner and repository: your repository
- Workflow name: `publish-pypi.yaml`
- Environment name: `pypi`

For a project that does not exist yet, add a pending publisher from your PyPI account instead.

### 3. Create the `pypi` environment

In the repository, open **Settings > Environments** and create `pypi`. Add a required reviewer so
a person approves each upload; PyPI never accepts the same version twice.

## Triggering

- **Release:** publishing a GitHub release starts the workflow. A release created with the default
  `GITHUB_TOKEN` does not start other workflows, so create releases with a GitHub App or personal
  token (the `auto-release` workflow does this when `GH_APP_ID` and `GH_APP_PRIVATE_KEY` are set).
- **Manually:** run the workflow from the Actions tab and enter an existing tag, for example
  `v1.2.3`.

## Run on self-hosted runners

Every job runs on GitHub-hosted `ubuntu-24.04` unless a runner variable is set. Add it under Settings, Secrets and variables, Actions, Variables (repository), or at organisation level to cover many repositories. The workflow reads `PUBLISH_PYPI_RUNS_ON` first and falls back to `RUNS_ON`, so one `RUNS_ON` variable can move all your ghwm workflows and `PUBLISH_PYPI_RUNS_ON` overrides it for this one. The value is JSON:

| Value | Runs on |
| --- | --- |
| unset | `ubuntu-24.04` (GitHub-hosted) |
| `"my-runner"` | a runner with that label |
| `["self-hosted", "linux"]` | a runner with all of those labels |

It is a variable, not an `env` value, because `runs-on` cannot read the workflow `env`. The runner needs outbound access to PyPI, and the `publish` job needs OIDC trusted publishing, which self-hosted runners support. Use self-hosted runners on public repositories with care, because pull requests from forks can run code on them.

## Update and remove

- Update: bump `version` in `ghwm.yml` and run `ghwm update`.
- Remove: delete the entry from `ghwm.yml` and run `ghwm install`.

## Known limitations

- The package must build with `uv build` (a `pyproject.toml` with a build backend).
- The release tag must match the package version, with or without a leading `v`.
- The environment link points to `https://pypi.org/project/<repository name>/`; edit it if your
  PyPI project name differs.
