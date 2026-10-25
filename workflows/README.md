# Workflows

This directory contains one folder per managed GitHub workflow.
Source repository: [ghwfxlab/ghwm-registry](https://github.com/ghwfxlab/ghwm-registry).

For consumer setup, start with the [root readme](../README.md). For maintainer workflow and
publishing guidance, use [CONTRIBUTING.md](../CONTRIBUTING.md).

Each workflow lives in its own folder:

- `workflows/<name>/README.md`
- `workflows/<name>/<name>.yml` or `workflows/<name>/<name>.yaml`
- `workflows/<name>/workflow.yml`
- `workflows/<name>/package.json`

## How it works

The `ghwm` CLI reads a `ghwm.yml` manifest in the consumer repository and
downloads versioned npm packages from GitHub Packages.

Each workflow package can install:

- the main workflow file in `.github/workflows/`
- packaged config files such as `.github/auto_assign.yaml`

## Available Workflows

| Workflow | Description | Docs |
| --- | --- | --- |
| `auto-assign-pr` | Automatically add pull-request reviewers and assignees using [kentaro-m/auto-assign-action](https://github.com/kentaro-m/auto-assign-action) | [Readme](auto-assign-pr/README.md) |
| `super-linter` | Code linting using [Super-Linter](https://github.com/super-linter/super-linter) and pre-commit hooks | [Readme](super-linter/README.md) |
| `publish-pypi` | Build a Python package and publish it to PyPI with trusted publishing | [Readme](publish-pypi/README.md) |
| `super-linter-lean` | Build, scan and publish a Super-Linter image with only the linters a repository enables | [Readme](super-linter-lean/README.md) |

## Runners

Every workflow runs on `ubuntu-24.04`. To use your own runner, edit `runs-on` in the installed workflow.
`ghwm update` keeps your `runs-on` by default (`update-runs-on: false` in `ghwm.yml`, available from ghwm v1.13.0)
and replaces it with the packaged value only when you set `update-runs-on: true` or pass `--update-runs-on`.
