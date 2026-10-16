# GHWM Update Workflow

The `ghwm-update` workflow checks the workflow packages pinned in `ghwm.yml`, bumps any outdated
versions, runs `ghwm update`, and opens a pull request with the refreshed manifest and installed
workflow files.

## Source of Truth

- Registry repository: [ghwfxlab/ghwm-registry](https://github.com/ghwfxlab/ghwm-registry)
- Workflow source: [`workflows/ghwm-update/ghwm-update.yaml`](./ghwm-update.yaml)

## What gets installed

After running `ghwm install`, the consumer repository gets:

- `.github/workflows/ghwm-update.yaml`
- An entry in `ghwm.lock`

## How it works

The workflow triggers in two ways:

- on a schedule at `0 6 * * *` (daily at 06:00 UTC)
- manually through `workflow_dispatch`

On each run, the workflow:

1. creates a GitHub App installation token with `contents`, `workflows`, and `pull-requests`
   permissions
2. reads the workflow list from `ghwm.yml`
3. checks GitHub Packages for newer `@<owner>/<name>` versions
4. updates the pinned versions in `ghwm.yml`
5. runs `ghwm update` to refresh `ghwm.lock` and the managed workflow files
6. opens or updates a pull request from `chore/ghwm-update` (force-pushing that branch; see
   [Review the branch and pull request conventions](#3-review-the-branch-and-pull-request-conventions))

## Permissions

These are the permissions declared by the installed workflow:

| Permission | Level |
| --- | --- |
| `contents` | `read` |
| `packages` | `read` |

The workflow then mints a GitHub App installation token inside the job for the write operations.

## Consumer Setup

### 1. Install the workflow

Add to `ghwm.yml` in your repository root:

```yaml
source: ghwfxlab/ghwm-registry
workflows:
  - name: ghwm-update
    version: 1.0.0
    update-triggers: true
```

Set `update-triggers: true` if you want future `ghwm update` runs to replace the installed schedule
or manual trigger with the packaged version.

Then run:

```sh
ghwm install
```

Commit these files:

- `.github/workflows/ghwm-update.yaml`
- `ghwm.lock`

### 2. Required secrets and variables

This workflow requires the following repository secrets:

| Secret | Purpose |
| --- | --- |
| `GH_APP_PRIVATE_KEY` | Private key for the GitHub App used to push workflow updates and open pull requests. |
| `GH_APP_CLIENT_ID` or `GH_APP_ID` | Identifier for the same GitHub App. |

The GitHub App must be installed on the consumer repository with:

- `contents: write`
- `workflows: write`
- `pull-requests: write`

The workflow uses `GHWM_PAT` when it is configured; otherwise, packages published by the same
repository use `GITHUB_TOKEN`. Package authentication follows npm's `NODE_AUTH_TOKEN` convention.
Add `GHWM_PAT` for packages published by another repository, or when the package's access controls
do not permit `GITHUB_TOKEN`. It must have `read:packages` and access to the source repositories.

### 3. Review the branch and pull request conventions

The workflow always uses:

- pull request branch: `chore/ghwm-update`
- commit title: `chore(ci): update ...`
- label: `flag:dependencies`

If a previous update PR is still open, the workflow updates that branch instead of opening a second
one. The `chore/ghwm-update` branch is owned by this workflow: each run **force-pushes** it, so any
manual commits pushed to that branch are overwritten on the next run. Make changes by editing
`ghwm.yml` (or the source packages) rather than committing directly to `chore/ghwm-update`.

### 4. Customize the installed workflow

Adjust `.github/workflows/ghwm-update.yaml` if your repository needs:

- a different schedule
- a different update branch name
- different pull request labels or title format
- a different pinned `ghwm` CLI version
- different GitHub App secret names

### 5. Trigger the workflow

The workflow runs automatically on its schedule.

To run it manually, open **Actions → Update ghwm packages → Run workflow**.

## Update

Update `ghwm.yml` with a new version, then:

```sh
ghwm update
```

By default, updates preserve the current `on:` section in `.github/workflows/ghwm-update.yaml`. Set
`update-triggers: true` if you want the packaged triggers to replace the current schedule or manual
dispatch trigger.

## Remove

Remove `ghwm-update` from `ghwm.yml`, then:

```sh
ghwm install         # full sync to the manifest
ghwm update --prune  # update remaining workflows and prune removed ones
```

That removes the managed workflow file for `ghwm-update` and updates `ghwm.lock` to match the
remaining manifest entries.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| The workflow warns that it cannot resolve the latest package version | The selected package token lacks access, or GitHub Packages is unavailable | Confirm `packages: read` is available for same-repository packages; otherwise update `GHWM_PAT` so it can read the relevant packages and source repositories |
| The job fails with "Could not resolve the latest version for any of the N package(s)" | Every package version lookup failed because package access is unavailable or GitHub Packages is unavailable | Fix the applicable package token or retry once the registry is available; the workflow fails instead of reporting a false "no updates" result |
| `ghwm update` fails to rewrite workflow files | The checkout token cannot modify `.github/workflows/*.yaml` | Confirm the GitHub App has `workflows: write` and that `GH_APP_PRIVATE_KEY` / `GH_APP_CLIENT_ID` or `GH_APP_ID` are correct |
| No pull request is created | All pinned versions in `ghwm.yml` already match the registry, or the run failed before the PR step | Review the `Check for ghwm package updates` step and confirm newer package versions exist |
| The workflow updates the manifest but misses installed files | `ghwm update` cannot authenticate to GitHub Packages | Verify `packages: read` for same-repository packages, or `GHWM_PAT` for another package source |

## Current Limitations

- The bundled workflow only checks the packages already listed in `ghwm.yml`; it does not add new
  workflow entries automatically.
- The workflow assumes workflow packages are published to GitHub Packages under the owner declared in
  `ghwm.yml`.
- The `ghwm` CLI is installed via `uv tool install git+https://github.com/ghwfxlab/ghwm.git@<tag>`
  (pinned via `env.GHWM_VERSION`, currently `v1.10.0`), which pins the CLI to a release tag.
