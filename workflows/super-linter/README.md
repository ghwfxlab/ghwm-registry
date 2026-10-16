# Super-Linter Workflow

The `super-linter` workflow adds code linting to your repository using [Super-Linter](https://github.com/super-linter/super-linter).

## Source of Truth

- Registry repository: [ghwfxlab/ghwm-registry](https://github.com/ghwfxlab/ghwm-registry)
- Workflow source: [`workflows/super-linter/super-linter.yaml`](./super-linter.yaml)

## What gets installed

After running `ghwm install`, the consumer repository gets:

- `.github/workflows/super-linter.yaml`
- `.github/super-linter.env`
- `.github/super-linter-fix.env`
- `.github/linters/actionlint.yml`
- `.github/linters/.gitleaks.toml`
- `.github/linters/.markdown-lint.yml`
- `.github/linters/.textlintrc`
- `.github/linters/.textlintignore`
- `.github/linters/.yaml-lint.yml`
- An entry in `ghwm.lock`

## How it works

The workflow triggers on pull requests and pushes to `main`, running the `super-linter` job.

Depending on your configuration, Super-Linter can run in one of three modes:

1. **Slim Mode (Default)**: Uses the lightweight `super-linter/super-linter/slim` image. It is faster to pull and start, and is ideal for projects that do not need heavier, platform-specific tooling.
2. **Standard/Full Mode**: Uses the full `super-linter/super-linter` image. This includes all supported linters, adding coverage for languages like **Rust** (Rustfmt/Clippy), **PowerShell** (PSScriptAnalyzer), **.NET** (dotnet tools), and **Azure Resource Manager** (arm-ttk).
3. **Custom Mode**: Runs a lean image as a `docker://` action step, which contains only the linters your `.github/super-linter.env` enables, so the linting itself starts and runs faster. The upstream steps are skipped, but the runner still pulls their images at job start. See [Run the lean image](#example-run-the-lean-image).

| Job | Environment Controls | Description |
| --- | --- | --- |
| `super-linter` | `RUN_SUPER_LINTER_SLIM: true` (default) | Runs the slim variant of Super-Linter for fast validation of common web/dev files (YAML, MD, JSON, Actions, text, etc.). |
| `super-linter` | `RUN_SUPER_LINTER_SLIM: false` | Runs the standard/full variant of Super-Linter to include heavier linters like Rustfmt, Clippy, .NET, PowerShell, and ARM templates. |
| `super-linter` | `SUPER_LINTER_CUSTOM: true` | Runs the image in the `Run the lean Super-Linter image` step and skips both upstream steps. It takes precedence over `RUN_SUPER_LINTER_SLIM`, which can stay `true`. |

### Linters enabled by default

| Validator | Config file |
| --- | --- |
| YAML (yamllint) | `.github/linters/.yaml-lint.yml` |
| Markdown (markdownlint) | `.github/linters/.markdown-lint.yml` |
| GitHub Actions (actionlint) | `.github/linters/actionlint.yml` |
| Secrets (gitleaks) | `.github/linters/.gitleaks.toml` |
| Natural language (textlint) | `.github/linters/.textlintrc` |
| JSON / JSON Prettier | (defaults) |
| Environment files | (defaults) |

## Permissions

The installed workflow requires these repository permissions:

| Permission | Level | Reason |
| --- | --- | --- |
| `contents` | `write` | Super-Linter may commit auto-fixes |
| `issues` | `write` | Super-Linter posts PR summary comments |
| `statuses` | `write` | Super-Linter sets commit status checks |
| `pull-requests` | `write` | Super-Linter posts PR comments |
| `packages` | `read` | Read packages if required |

## Consumer Setup

### 1. Install the workflow

Add to `ghwm.yml` in your repository root:

```yaml
source: ghwfxlab/ghwm-registry
workflows:
  - name: super-linter
    version: 2.0.0
    update-config-files: true
```

Set `update-config-files: true` if you want future updates to refresh the packaged linter config files. Without it, config files are only created on the first install.

Then run:

```sh
ghwm install
```

Commit these files:

- `.github/workflows/super-linter.yaml`
- `.github/super-linter.env`
- `.github/super-linter-fix.env`
- `.github/linters/` (all config files)
- `ghwm.lock`

### 2. Customise linter configuration

The installed config files are a starting point. Adjust them to your project's needs:

> [!NOTE]
> For a full list of all available configuration options, validators, and environment variables, please refer to the [official Super-Linter configuration documentation](https://github.com/super-linter/super-linter/blob/main/docs/configuration.md).

- **`.github/super-linter.env`** — enable or disable validators by adding `VALIDATE_<LANG>=true/false`
- **`.github/super-linter-fix.env`** — enable or disable autofix for validators by adding `FIX_<LANG>=true/false`
- **`.github/linters/.yaml-lint.yml`** — yamllint rules
- **`.github/linters/.markdown-lint.yml`** — markdownlint rules
- **`.github/linters/.textlintrc`** — natural language terminology rules
- **`.github/linters/actionlint.yml`** — actionlint ignore patterns
- **`.github/workflows/super-linter.yaml`** — customise the workflow behavior via its environment variables:
  - `PRE_SUPER_LINTER_CUSTOM_SCRIPT_PATH` — path to an optional custom script to run before linting.
  - `RUN_SUPER_LINTER_SLIM` — set to `true` (default) to run the slim version of Super-Linter, or `false` for the full version.
  - `RUN_SUPER_LINTER_FIXES` — set to `true` to enable automatic linting fixes (default: `false`). If enabled, fixes will be automatically committed and pushed to your PR branch.
  - `SUPER_LINTER_CUSTOM` — set to `true` to run the lean image step (default: `false`).

#### Example: Run Standard/Full Super-Linter (e.g. for Rust or .NET projects)

To use the standard/full version of Super-Linter instead of the slim default, edit the `env` section in `.github/workflows/super-linter.yaml`:

```yaml
env:
  PRE_SUPER_LINTER_CUSTOM_SCRIPT_PATH: ""
  SUPER_LINTER_CONFIG_PATH: .github/super-linter.env
  SUPER_LINTER_FIX_CONFIG_PATH: .github/super-linter-fix.env
  RUN_SUPER_LINTER_SLIM: false # Disable slim mode to run the full runner
  RUN_SUPER_LINTER_FIXES: false
```

#### Example: Run the lean image

Set `SUPER_LINTER_CUSTOM` in the `env` section of `.github/workflows/super-linter.yaml` and set your image in the `uses` of the `Run the lean Super-Linter image` step:

```yaml
env:
  RUN_SUPER_LINTER_SLIM: true
  SUPER_LINTER_CUSTOM: true
```

```yaml
      - name: Run the lean Super-Linter image
        if: ${{ env.SUPER_LINTER_CUSTOM == 'true' }}
        uses: docker://ghcr.io/my-org/my-repo/super-linter-lean:v9.0.0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The step is a regular container action, so the runner passes the `GITHUB_*` variables, mounts the workspace and handles the file commands. `uses` cannot take an expression, so the image is written in the step. Use an image built by the `super-linter-lean` workflow or generated by [superlint-lean](https://github.com/ghwfxlab/superlint-lean). It must be a Super-Linter image: it keeps the upstream entrypoint (`/action/lib/linter.sh`) and has the linters your `VALIDATE_*` flags enable. The workflow ships the upstream slim image as the default so the job still starts before you set yours.

On pull requests the workflow also runs `superlint-lean drift`, which fails the check when a changed file needs a linter that `.github/super-linter.env` does not enable (the lean image would skip it). Add the missing `VALIDATE_*` flag, or exclude the file type with `FILTER_REGEX_EXCLUDE`.

The runner pulls the image of every step at job start, before any step runs, and does not log in to registries. The image must be public, or a `ghcr.io` package that grants the runner read access.

Changing the linter flags in a pull request does not change the image that pull request is linted with, because the image is rebuilt only after the change is merged. Expect the first run after merging a flag change to use the previous image.

#### Example: Enable Automatic Linting Fixes

To automatically run linter fixes and commit/push them back to pull request branches, edit the `env` section in `.github/workflows/super-linter.yaml`:

```yaml
env:
  PRE_SUPER_LINTER_CUSTOM_SCRIPT_PATH: ""
  SUPER_LINTER_CONFIG_PATH: .github/super-linter.env
  SUPER_LINTER_FIX_CONFIG_PATH: .github/super-linter-fix.env
  RUN_SUPER_LINTER_SLIM: true
  RUN_SUPER_LINTER_FIXES: true # Enable fixing and committing of fixes
```

You can then customize which linters apply auto-fixes by editing `.github/super-linter-fix.env`:

```env
# Enable or disable fixing per language
FIX_MARKDOWN=true
FIX_YAML=false
```

### 3. Trigger the workflow

The workflow runs automatically on:

- Pull requests targeting `main`
- Pushes to `main`

To change the trigger branches, edit `.github/workflows/super-linter.yaml` and update the `branches` lists under `on.pull_request` and `on.push`.

## Update

### Upgrading from 1.x to 2.0

Version 2.0 adds the custom mode. What changes for you:

- New: `SUPER_LINTER_CUSTOM` and a step for the lean image. With the default `SUPER_LINTER_CUSTOM: false` nothing changes: same upstream steps, config files and variables.

Update `ghwm.yml` with a new version, then:

```sh
ghwm update
```

By default, updates preserve the existing `on:` section in `.github/workflows/super-linter.yaml` and leave the installed config files untouched. Set `update-config-files: true` for this workflow in `ghwm.yml` when you want the packaged config files to replace the current ones during updates.

## Remove

Remove `super-linter` from `ghwm.yml`, then:

```sh
ghwm install         # full sync to the manifest
ghwm update --prune  # update remaining workflows and prune removed ones
```

That removes the managed workflow file for `super-linter` and updates `ghwm.lock` to match the remaining manifest entries.

The CLI leaves config files such as `.github/super-linter.env`, `.github/super-linter-fix.env`, and `.github/linters/` in place so you can decide whether to keep or remove them.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Custom image cannot be pulled | The image is private or the tag does not exist | Use a public image or a `ghcr.io` package the runner can read |
| Super-Linter fails on YAML files | yamllint config too strict | Adjust rules in `.github/linters/.yaml-lint.yml` |
| Super-Linter fails on Markdown files | markdownlint config mismatch | Adjust rules in `.github/linters/.markdown-lint.yml` |
| Gitleaks false positives | Missing or incomplete gitleaks config | Add allow-listing rules to `.github/linters/.gitleaks.toml` |
| Natural language errors for project terms | textlint terminology rules too strict | Update `exclude` patterns in `.github/linters/.textlintrc` |
