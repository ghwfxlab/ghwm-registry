# Contributing to ghwm-registry

Thank you for improving the GitHub Workflows Registry!

## Table of Contents

- [Adding a new workflow](#adding-a-new-workflow)
- [Updating an existing workflow](#updating-an-existing-workflow)
- [Development setup](#development-setup)
- [Quality checks](#quality-checks)
- [Pull request guidelines](#pull-request-guidelines)
- [Publishing workflow packages](#publishing-workflow-packages)

---

## Adding a new workflow

1. **Create the workflow directory.**

   ```sh
   mkdir workflows/<name>
   ```

2. **Add the workflow YAML file**, named `<name>.yml` (or `<name>.yaml`).

    Follow the naming convention used by `super-linter`: the filename must match the directory name.

3. **Add `workflow.yml`** inside the workflow directory.

   This file declares which packaged files the CLI installs and where they should be written in
   the consumer repository.

   ```yaml
   name: <name>
   files:
     - source: <name>.yml
       target: .github/workflows/<name>.yml
   ```

4. **Add `package.json`** inside the workflow directory.

    ```json
    {
      "name": "@ghwfxlab/ghwm-<name>",
      "version": "1.0.0",
      "files": ["<name>.yml", "workflow.yml"],
      "publishConfig": { "registry": "https://npm.pkg.github.com" }
    }
   ```

5. **Add a `README.md`** inside the workflow directory. It must cover at minimum:

    - What the workflow does (one-paragraph summary)
    - What gets installed in the consumer repository
    - Consumer setup steps (secrets, variables, permissions)
    - How to trigger the workflow
    - How to update and remove the workflow
    - Known limitations or caveats

6. **Register the workflow** in both index files:

     - `workflows/README.md` — add a row to the Available Workflows table
     - `README.md` — add a row to the Available Workflows table

   The root `package.json` already includes `workspaces: ["workflows/*"]`, so new workflow
   directories are picked up automatically.

7. **Open a pull request** and request review from a maintainer.

---

## Updating an existing workflow

1. Edit the workflow YAML, `workflow.yml`, `package.json`, and/or its `README.md` as needed.
2. Bump `workflows/<name>/package.json` when the change should ship to consumers.
3. If inputs, outputs, secrets, permissions, or packaged config files changed, update the readme
   accordingly.
4. Remember that consumer repositories control update behaviour in `ghwm.yml`:
   - `update-triggers: true|false` decides whether workflow updates replace the installed `on:`
     section or preserve the repository's current trigger configuration.
   - `update-config-files: true|false` decides whether workflow updates replace packaged config files
     or leave the existing checked-in copies untouched.

---

## Development setup

**Prerequisites**: Git, Node.js ≥ 18 (for `textlint`), Python ≥ 3.9 (for `pre-commit`), Docker (for `super-linter`).

```sh
# Install pre-commit hooks
make setup-precommit

# Verify everything is wired up
make precommit
```

---

## Quality checks

| Command | What it does |
| --- | --- |
| `make lang` | Lint prose (terminology, style) with textlint |
| `make lang-fix` | Autofix textlint violations |
| `make script-tests` | Run unit tests for the `scripts/workflow_package_versions.py` helper |
| `make precommit` | Run all pre-commit hooks on every file |
| `make super-linter` | Full lint pass (YAML, Markdown, Actions) via Docker |
| `make super-linter-fix` | Full lint pass with autofix via Docker |

Run `make lang` and `make precommit` before pushing. CI runs the same checks automatically.
The pre-commit hook also runs `make script-tests` automatically on every commit.

---

## Pull request guidelines

- Use a descriptive title following [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat(super-linter): add RUN_SUPER_LINTER_SLIM variable docs`).
- Fill in the pull request template.
- Keep each PR focused on a single workflow or concern.
- Ensure `make lang` passes with no errors.
- Do **not** push directly to `main`; all changes go through pull requests.

---

## Publishing workflow packages

Publishing is automatic on merge to `main`.

The [publish workflow](.github/workflows/publish.yml) scans every workflow package under
`workflows/`, compares the version in `package.json` to GitHub Packages, and publishes only the
packages whose version is new.

Version management uses two safeguards:

- The local pre-commit hook checks staged workflow package content against the latest published
  package version. If the staged package content changed and the local version is not ahead of the
  published version, it patches `package.json` to the next patch version, stages the file, prints
  the change, and stops the commit so you can review it and rerun `git commit`.
- Pull request CI repeats the same comparison for changed published package content and adds a pull
  request comment if any changed workflow package still needs a version bump.

The automation only considers published package content: `package.json` plus the paths listed in
the workflow package `files` array. Workflow-specific readme-only changes do not trigger a version
bump because the readme is not shipped in the npm package.

If you want a **minor** or **major** release, bump the workflow package version in
`workflows/<name>/package.json` yourself before committing so the automation does not replace it
with a patch bump.

Use semantic versioning:

- **Patch** — bugfixes, documentation corrections, no behaviour change
- **Minor** — new optional inputs, additive features, new packaged config files
- **Major** — breaking changes (renamed files, removed inputs, permission changes, changed default triggers)
