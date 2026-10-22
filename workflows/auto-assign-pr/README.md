# Auto Assign PR Workflow

The `auto-assign-pr` workflow automatically adds pull request reviewers and assignees when a pull request is opened or marked ready for review.

## Source of Truth

- Registry repository: [ghwfxlab/ghwm-registry](https://github.com/ghwfxlab/ghwm-registry)
- Workflow source: [`workflows/auto-assign-pr/auto-assign-pr.yaml`](./auto-assign-pr.yaml)
- Example config: [`workflows/auto-assign-pr/config/auto_assign.yaml`](./config/auto_assign.yaml)

## What gets installed

After running `ghwm install`, the consumer repository gets:

- `.github/workflows/auto-assign-pr.yaml`
- `.github/auto_assign.yaml` on the first install when the file is missing
- An entry in `ghwm.lock`

## How it works

The workflow triggers on `pull_request` for these activity types:

- `opened`
- `ready_for_review`

It runs [`kentaro-m/auto-assign-action`](https://github.com/kentaro-m/auto-assign-action) with `configuration-path: .github/auto_assign.yaml`.

## Permissions

These are the permissions declared by the installed workflow:

| Permission | Level |
| --- | --- |
| `contents` | `write` |
| `pull-requests` | `write` |

## Consumer Setup

### 1. Install the workflow

Add to `ghwm.yml` in your repository root:

```yaml
source: ghwfxlab/ghwm-registry
workflows:
  - name: auto-assign-pr
    version: 1.0.0
    update-triggers: true
    update-config-files: true
```

This example opts in to replacing both the installed workflow triggers and
`.github/auto_assign.yaml` during future `ghwm update` runs.

Then run:

```sh
ghwm install
```

Commit these files:

- `.github/workflows/auto-assign-pr.yaml`
- `ghwm.lock`

### 2. Review and commit `.github/auto_assign.yaml`

On the first install, the CLI copies the packaged example to `.github/auto_assign.yaml` if that
file does not already exist.

Commit `.github/auto_assign.yaml` after you confirm the generated defaults match your repository.

The generated file starts like this:

```yaml
addReviewers: false
addAssignees: author
numberOfAssignees: 0
skipKeywords:
  - wip
```

Common options:

- Set `addReviewers: true` and add `reviewers` or `reviewGroups` to request reviewers automatically.
- Keep `addAssignees: author` to assign the PR author, or use `assignees` / `assigneeGroups` to assign other users.
- Use `filterLabels` or `runOnDraft` to narrow when auto-assignment should run.

If you later want workflow updates to replace the packaged config file, set
`update-config-files: true` for this workflow in `ghwm.yml`.

### 3. Trigger the workflow

Open a pull request or mark a draft pull request as **Ready for review**.

## Run on self-hosted runners

Every job runs on GitHub-hosted `ubuntu-slim` unless a runner variable is set. Add it under Settings, Secrets and variables, Actions, Variables (repository), or at organisation level to cover many repositories. The workflow reads `AUTO_ASSIGN_PR_RUNS_ON` first and falls back to `RUNS_ON`, so one `RUNS_ON` variable can move all your ghwm workflows and `AUTO_ASSIGN_PR_RUNS_ON` overrides it for this one. The value is JSON:

| Value | Runs on |
| --- | --- |
| unset | `ubuntu-slim` (GitHub-hosted) |
| `"my-runner"` | a runner with that label |
| `["self-hosted", "linux"]` | a runner with all of those labels |

It is a variable, not an `env` value, because `runs-on` cannot read the workflow `env`. Use self-hosted runners on public repositories with care, because pull requests from forks can run code on them.

## Update

Update `ghwm.yml` with a new version, then:

```sh
ghwm update
```

By default, updates preserve the current `on:` section in
`.github/workflows/auto-assign-pr.yaml` and leave `.github/auto_assign.yaml` untouched. Set
`update-triggers: true` if you want the packaged triggers to replace the current workflow triggers.
Set `update-config-files: true` if you want the packaged config file to replace the current file
during workflow updates.

## Remove

Remove `auto-assign-pr` from `ghwm.yml`, then:

```sh
ghwm install         # full sync to the manifest
ghwm update --prune  # update remaining workflows and prune removed ones
```

That removes the managed workflow file for `auto-assign-pr` and updates `ghwm.lock` to
match the remaining manifest entries.

The CLI leaves `.github/auto_assign.yaml` in place so you can decide whether to keep or remove it
from the consumer repository.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Workflow runs but no reviewers are added | `addReviewers` is `false`, or no `reviewers` / `reviewGroups` are configured | Enable `addReviewers` and add reviewers or review groups in `.github/auto_assign.yaml` |
| No assignee is added | `addAssignees` is `false`, or no assignees are configured | Use `addAssignees: author` or configure `assignees` / `assigneeGroups` |
| Workflow is skipped for WIP PRs | The PR title or body matches `skipKeywords` | Remove the keyword or adjust `skipKeywords` |
| Fork or Dependabot PRs are not handled | The workflow uses `pull_request` | Switch to `pull_request_target` only after reviewing the security implications |
| The jobs never start or queue forever | No runner has the label `ubuntu-slim` (or the account has no hosted minutes) | Set `AUTO_ASSIGN_PR_RUNS_ON` or `RUNS_ON` to your runner label(s) |

## Current Limitations

- The bundled workflow uses `pull_request`, so PRs from forks or automation may need a different trigger strategy.
