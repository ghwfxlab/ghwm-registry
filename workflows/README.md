# Workflows

This directory contains one folder per managed GitHub workflow.
Source repository: [pljanicki/ghwm-marketplace](https://github.com/pljanicki/ghwm-marketplace).

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
| `auto-assign-pr` | Automatically add pull-request reviewers and assignees | [Readme](auto-assign-pr/README.md) |
| `super-linter` | Code linting using Super-Linter and pre-commit hooks | [Readme](super-linter/README.md) |
