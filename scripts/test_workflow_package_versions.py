from __future__ import annotations

import io
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().with_name("workflow_package_versions.py")
MODULE_SPEC = importlib.util.spec_from_file_location("workflow_package_versions", MODULE_PATH)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError(f"Could not load module spec from {MODULE_PATH}")
workflow_package_versions = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = workflow_package_versions
MODULE_SPEC.loader.exec_module(workflow_package_versions)

WORKFLOW_NAME = "super-linter"
WORKFLOW_PACKAGE_NAME = "@pljanicki/ghwm-super-linter"
WORKFLOW_DIR_RELATIVE = Path("workflows") / WORKFLOW_NAME
WORKFLOW_FILE_NAME = f"{WORKFLOW_NAME}.yml"
WORKFLOW_FILE_RELATIVE = WORKFLOW_DIR_RELATIVE / WORKFLOW_FILE_NAME
README_FILE_RELATIVE = WORKFLOW_DIR_RELATIVE / "README.md"
PACKAGE_JSON_RELATIVE = WORKFLOW_DIR_RELATIVE / "package.json"
INITIAL_VERSION = "1.0.0"
PATCH_VERSION = "1.0.1"
TOKEN = "token"
ENV_TOKEN = "env-token"
SCRIPT_REPO_ROOT = Path("/tmp/workflow-package-versions")
README_CONTENT = "# Super-Linter\n"
DOCS_ONLY_README_CONTENT = "# Super-Linter\n\nDocs only change.\n"
INITIAL_WORKFLOW_CONTENT = f"name: {WORKFLOW_NAME}\non: pull_request\n"
UPDATED_WORKFLOW_CONTENT = f"name: {WORKFLOW_NAME}\non: [pull_request, issue_comment]\n"
WORKFLOW_MANIFEST_CONTENT = (
    f"name: {WORKFLOW_NAME}\n"
    "files:\n"
    f"  - source: {WORKFLOW_FILE_NAME}\n"
    f"    target: .github/workflows/{WORKFLOW_FILE_NAME}\n"
    "  - source: config/auto_assign.yaml\n"
    "    target: .github/auto_assign.yaml\n"
)
CONFIG_FILE_CONTENT = "reviewers:\n  - octocat\n"
PUBLISHED_FILES = (WORKFLOW_FILE_NAME, "workflow.yml", "config/")


def _git(repo_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        check=True,
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    return result.stdout


class WorkflowPackageVersionsTests(unittest.TestCase):
    def create_repo(self, *, version: str = INITIAL_VERSION) -> tuple[Path, Path]:
        tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(tempdir.cleanup)
        repo_root = Path(tempdir.name)

        _git(repo_root, "init")
        _git(repo_root, "config", "user.name", "Test User")
        _git(repo_root, "config", "user.email", "test@example.com")

        workflow_dir = repo_root / WORKFLOW_DIR_RELATIVE
        (workflow_dir / "config").mkdir(parents=True)
        (workflow_dir / "README.md").write_text(README_CONTENT, encoding="utf-8")
        (workflow_dir / WORKFLOW_FILE_NAME).write_text(INITIAL_WORKFLOW_CONTENT, encoding="utf-8")
        (workflow_dir / "workflow.yml").write_text(WORKFLOW_MANIFEST_CONTENT, encoding="utf-8")
        (workflow_dir / "config" / "auto_assign.yaml").write_text(
            CONFIG_FILE_CONTENT,
            encoding="utf-8",
        )
        (workflow_dir / "package.json").write_text(
            json.dumps(
                {
                    "name": WORKFLOW_PACKAGE_NAME,
                    "version": version,
                    "files": list(PUBLISHED_FILES),
                    "publishConfig": {"registry": workflow_package_versions.REGISTRY_URL},
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        _git(repo_root, "add", ".")
        _git(repo_root, "commit", "-m", "initial")
        return repo_root, workflow_dir

    def test_tracks_path_when_path_matches_package_files_and_directories(self) -> None:
        # Arrange
        package_dir = Path("/tmp/workflows") / WORKFLOW_NAME
        package = workflow_package_versions.WorkflowPackage(
            workflow_name=WORKFLOW_NAME,
            package_dir=package_dir,
            package_json_path=package_dir / "package.json",
            package_name=WORKFLOW_PACKAGE_NAME,
            version=INITIAL_VERSION,
            published_files=PUBLISHED_FILES,
        )

        # Act & Assert
        self.assertTrue(package.tracks_path("package.json"))
        self.assertTrue(package.tracks_path(WORKFLOW_FILE_NAME))
        self.assertTrue(package.tracks_path("config"))
        self.assertTrue(package.tracks_path("config/auto_assign.yaml"))
        self.assertFalse(package.tracks_path("README.md"))

    def test_changed_packages_from_paths_when_changes_are_readme_only(self) -> None:
        repo_root, _ = self.create_repo()

        changed_packages = workflow_package_versions._changed_packages_from_paths(
            repo_root,
            [README_FILE_RELATIVE.as_posix()],
        )

        self.assertEqual(changed_packages, [])

    def test_changed_packages_from_paths_when_readme_is_listed_first(self) -> None:
        repo_root, _ = self.create_repo()

        changed_packages = workflow_package_versions._changed_packages_from_paths(
            repo_root,
            [
                README_FILE_RELATIVE.as_posix(),
                WORKFLOW_FILE_RELATIVE.as_posix(),
            ],
        )

        self.assertEqual([package.workflow_name for package in changed_packages], [WORKFLOW_NAME])

    def test_parse_release_version_when_semver_is_non_plain(self) -> None:
        for raw_version in ("1.0", "1.0.0-beta", "01.2.3"):
            with self.subTest(raw_version=raw_version):
                with self.assertRaisesRegex(ValueError, "Use MAJOR.MINOR.PATCH versions"):
                    workflow_package_versions._parse_release_version(raw_version)

    def test_gh_cli_token_when_gh_is_unavailable(self) -> None:
        # Arrange
        with mock.patch.object(workflow_package_versions.shutil, "which", return_value=None):
            # Act
            token = workflow_package_versions._gh_cli_token()

        # Assert
        self.assertIsNone(token)

    def test_github_token_when_gh_cli_has_no_token(self) -> None:
        # Arrange
        with (
            mock.patch.object(workflow_package_versions, "_gh_cli_token", return_value=None),
            mock.patch.dict(workflow_package_versions.os.environ, {"GH_TOKEN": ENV_TOKEN}, clear=True),
        ):
            # Act
            token = workflow_package_versions._github_token()

        # Assert
        self.assertEqual(token, ENV_TOKEN)

    def test_range_paths_when_merge_base_cannot_be_resolved(self) -> None:
        # Arrange
        with mock.patch.object(workflow_package_versions, "_run_git", return_value=""):
            # Act & Assert
            with self.assertRaisesRegex(RuntimeError, "Could not resolve a merge-base"):
                workflow_package_versions._range_paths(Path("/tmp"), base_ref="main", head_ref="HEAD")

    def test_load_workflow_package_when_files_array_is_invalid(self) -> None:
        # Arrange
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / "package.json").write_text(
            json.dumps(
                {
                    "name": WORKFLOW_PACKAGE_NAME,
                    "version": INITIAL_VERSION,
                    "files": [""],
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        # Act & Assert
        with self.assertRaisesRegex(ValueError, "files' array of non-empty strings"):
            workflow_package_versions._load_workflow_package(repo_root, WORKFLOW_NAME)

    def test_fix_staged_when_changes_are_readme_only(self) -> None:
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / "README.md").write_text(DOCS_ONLY_README_CONTENT, encoding="utf-8")
        _git(repo_root, "add", README_FILE_RELATIVE.as_posix())

        result = workflow_package_versions.fix_staged(repo_root)

        self.assertEqual(result, 0)
        package_data = json.loads((workflow_dir / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package_data["version"], INITIAL_VERSION)

    def test_fix_staged_when_token_is_missing_for_publishable_change(self) -> None:
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / WORKFLOW_FILE_NAME).write_text(UPDATED_WORKFLOW_CONTENT, encoding="utf-8")
        _git(repo_root, "add", WORKFLOW_FILE_RELATIVE.as_posix())

        with mock.patch.object(workflow_package_versions, "_github_token", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Cannot auto-bump workflow package versions"):
                workflow_package_versions.fix_staged(repo_root)

    def test_fix_staged_when_local_version_is_outdated(self) -> None:
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / WORKFLOW_FILE_NAME).write_text(UPDATED_WORKFLOW_CONTENT, encoding="utf-8")
        _git(repo_root, "add", WORKFLOW_FILE_RELATIVE.as_posix())

        with (
            mock.patch.object(workflow_package_versions, "_github_token", return_value=TOKEN),
            mock.patch.object(
                workflow_package_versions,
                "_read_published_version",
                return_value=INITIAL_VERSION,
            ),
        ):
            result = workflow_package_versions.fix_staged(repo_root)

        self.assertEqual(result, 1)
        package_data = json.loads((workflow_dir / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package_data["version"], PATCH_VERSION)
        self.assertIn(
            PACKAGE_JSON_RELATIVE.as_posix(),
            _git(repo_root, "diff", "--cached", "--name-only").splitlines(),
        )

    def test_fix_staged_when_local_version_is_already_ahead(self) -> None:
        repo_root, workflow_dir = self.create_repo(version=PATCH_VERSION)
        (workflow_dir / WORKFLOW_FILE_NAME).write_text(UPDATED_WORKFLOW_CONTENT, encoding="utf-8")
        _git(repo_root, "add", WORKFLOW_FILE_RELATIVE.as_posix())

        with (
            mock.patch.object(workflow_package_versions, "_github_token", return_value=TOKEN),
            mock.patch.object(
                workflow_package_versions,
                "_read_published_version",
                return_value=INITIAL_VERSION,
            ),
        ):
            result = workflow_package_versions.fix_staged(repo_root)

        self.assertEqual(result, 0)
        package_data = json.loads((workflow_dir / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package_data["version"], PATCH_VERSION)
        self.assertNotIn(
            PACKAGE_JSON_RELATIVE.as_posix(),
            _git(repo_root, "diff", "--cached", "--name-only").splitlines(),
        )

    def test_fix_staged_when_package_has_not_been_published_yet(self) -> None:
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / WORKFLOW_FILE_NAME).write_text(UPDATED_WORKFLOW_CONTENT, encoding="utf-8")
        _git(repo_root, "add", WORKFLOW_FILE_RELATIVE.as_posix())

        with (
            mock.patch.object(workflow_package_versions, "_github_token", return_value=TOKEN),
            mock.patch.object(
                workflow_package_versions,
                "_read_published_version",
                return_value=None,
            ),
        ):
            result = workflow_package_versions.fix_staged(repo_root)

        self.assertEqual(result, 0)
        package_data = json.loads((workflow_dir / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package_data["version"], INITIAL_VERSION)

    def test_check_range_when_changes_are_docs_only(self) -> None:
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / "README.md").write_text(DOCS_ONLY_README_CONTENT, encoding="utf-8")
        _git(repo_root, "add", README_FILE_RELATIVE.as_posix())
        _git(repo_root, "commit", "-m", "docs only")

        report_path = repo_root / "docs-report.json"
        result = workflow_package_versions.check_range(
            repo_root,
            base_ref="HEAD~1",
            head_ref="HEAD",
            report_path=report_path,
        )

        self.assertEqual(result, 0)
        self.assertEqual(json.loads(report_path.read_text(encoding="utf-8")), {"checked": [], "outdated": []})

    def test_check_range_when_local_version_is_not_ahead(self) -> None:
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / WORKFLOW_FILE_NAME).write_text(UPDATED_WORKFLOW_CONTENT, encoding="utf-8")
        _git(repo_root, "add", WORKFLOW_FILE_RELATIVE.as_posix())
        _git(repo_root, "commit", "-m", "workflow change")

        report_path = repo_root / "workflow-report.json"
        with (
            mock.patch.object(workflow_package_versions, "_github_token", return_value=TOKEN),
            mock.patch.object(
                workflow_package_versions,
                "_read_published_version",
                return_value=INITIAL_VERSION,
            ),
        ):
            result = workflow_package_versions.check_range(
                repo_root,
                base_ref="HEAD~1",
                head_ref="HEAD",
                report_path=report_path,
            )

        report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(result, 1)
        self.assertEqual(
            report["checked"],
            [
                {
                    "workflow": WORKFLOW_NAME,
                    "package_name": WORKFLOW_PACKAGE_NAME,
                    "local_version": INITIAL_VERSION,
                    "published_version": INITIAL_VERSION,
                    "state": "outdated",
                }
            ],
        )
        self.assertEqual(report["outdated"], report["checked"])

    def test_check_range_when_package_is_unpublished(self) -> None:
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / WORKFLOW_FILE_NAME).write_text(UPDATED_WORKFLOW_CONTENT, encoding="utf-8")
        _git(repo_root, "add", WORKFLOW_FILE_RELATIVE.as_posix())
        _git(repo_root, "commit", "-m", "workflow change")

        report_path = repo_root / "workflow-report.json"
        with (
            mock.patch.object(workflow_package_versions, "_github_token", return_value=TOKEN),
            mock.patch.object(
                workflow_package_versions,
                "_read_published_version",
                return_value=None,
            ),
        ):
            result = workflow_package_versions.check_range(
                repo_root,
                base_ref="HEAD~1",
                head_ref="HEAD",
                report_path=report_path,
            )

        report = json.loads(report_path.read_text(encoding="utf-8"))
        self.assertEqual(result, 0)
        self.assertEqual(
            report["checked"],
            [
                {
                    "workflow": WORKFLOW_NAME,
                    "package_name": WORKFLOW_PACKAGE_NAME,
                    "local_version": INITIAL_VERSION,
                    "published_version": "",
                    "state": "new",
                }
            ],
        )
        self.assertEqual(report["outdated"], [])

    def test_read_published_version_when_npm_list_succeeds(self) -> None:
        # Arrange
        with mock.patch.object(
            workflow_package_versions.subprocess,
            "run",
            return_value=mock.Mock(returncode=0, stdout='["0.9.0", "1.0.0"]', stderr=""),
        ):
            # Act
            version = workflow_package_versions._read_published_version(WORKFLOW_PACKAGE_NAME, TOKEN)

        # Assert
        self.assertEqual(version, INITIAL_VERSION)

    def test_read_published_version_when_npm_authentication_fails(self) -> None:
        # Arrange
        with mock.patch.object(
            workflow_package_versions.subprocess,
            "run",
            return_value=mock.Mock(returncode=1, stdout="", stderr="ENEEDAUTH"),
        ):
            # Act & Assert
            with self.assertRaisesRegex(RuntimeError, "authentication is required"):
                workflow_package_versions._read_published_version(WORKFLOW_PACKAGE_NAME, TOKEN)

    def test_read_published_version_when_registry_returns_404(self) -> None:
        # Arrange
        with mock.patch.object(
            workflow_package_versions.subprocess,
            "run",
            return_value=mock.Mock(returncode=1, stdout="", stderr="E404 package missing"),
        ):
            # Act
            version = workflow_package_versions._read_published_version(WORKFLOW_PACKAGE_NAME, TOKEN)

        # Assert
        self.assertIsNone(version)

    def test_read_published_version_when_npm_is_missing(self) -> None:
        # Arrange
        with mock.patch.object(
            workflow_package_versions.subprocess,
            "run",
            side_effect=FileNotFoundError("npm"),
        ):
            # Act & Assert
            with self.assertRaisesRegex(RuntimeError, "npm is required"):
                workflow_package_versions._read_published_version(WORKFLOW_PACKAGE_NAME, TOKEN)

    def test_check_range_when_token_is_missing_and_validation_is_needed(self) -> None:
        # Arrange
        repo_root, workflow_dir = self.create_repo()
        (workflow_dir / WORKFLOW_FILE_NAME).write_text(UPDATED_WORKFLOW_CONTENT, encoding="utf-8")
        _git(repo_root, "add", WORKFLOW_FILE_RELATIVE.as_posix())
        _git(repo_root, "commit", "-m", "workflow change")

        # Act & Assert
        with mock.patch.object(workflow_package_versions, "_github_token", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Set GH_TOKEN or GITHUB_TOKEN in CI"):
                workflow_package_versions.check_range(
                    repo_root,
                    base_ref="HEAD~1",
                    head_ref="HEAD",
                    report_path=None,
                )

    def test_main_when_called_with_fix_staged_argument(self) -> None:
        # Arrange
        with (
            mock.patch.object(workflow_package_versions.sys, "argv", ["workflow_package_versions.py", "fix-staged"]),
            mock.patch.object(workflow_package_versions, "_repo_root", return_value=SCRIPT_REPO_ROOT),
            mock.patch.object(workflow_package_versions, "fix_staged", return_value=0) as mock_fix_staged,
        ):
            # Act
            exit_code = workflow_package_versions.main()

        # Assert
        self.assertEqual(exit_code, 0)
        mock_fix_staged.assert_called_once_with(SCRIPT_REPO_ROOT)

    def test_main_when_command_fails(self) -> None:
        # Arrange
        stderr = io.StringIO()
        with (
            mock.patch.object(workflow_package_versions.sys, "argv", ["workflow_package_versions.py", "fix-staged"]),
            mock.patch.object(workflow_package_versions.sys, "stderr", stderr),
            mock.patch.object(workflow_package_versions, "_repo_root", return_value=SCRIPT_REPO_ROOT),
            mock.patch.object(
                workflow_package_versions,
                "fix_staged",
                side_effect=RuntimeError("boom"),
            ),
        ):
            # Act
            exit_code = workflow_package_versions.main()

        # Assert
        self.assertEqual(exit_code, 1)
        self.assertIn("boom", stderr.getvalue())

    def test_get_workflow_name_from_path_when_path_belongs_to_workflow(self) -> None:
        # Arrange
        path = "workflows/super-linter/package.json"

        # Act
        name = workflow_package_versions._get_workflow_name_from_path(path)

        # Assert
        self.assertEqual(name, "super-linter")

    def test_get_workflow_name_from_path_when_path_is_outside_workflows_directory(self) -> None:
        # Arrange
        path = "src/ui/package.json"

        # Act
        name = workflow_package_versions._get_workflow_name_from_path(path)

        # Assert
        self.assertIsNone(name)

    def test_check_package_version_when_package_is_outdated(self) -> None:
        # Arrange
        package_dir = Path("/tmp/workflows") / WORKFLOW_NAME
        package = workflow_package_versions.WorkflowPackage(
            workflow_name=WORKFLOW_NAME,
            package_dir=package_dir,
            package_json_path=package_dir / "package.json",
            package_name=WORKFLOW_PACKAGE_NAME,
            version=INITIAL_VERSION,
            published_files=PUBLISHED_FILES,
        )

        with (
            mock.patch.object(
                workflow_package_versions,
                "_read_published_version",
                return_value=INITIAL_VERSION,
            ),
        ):
            # Act
            entry = workflow_package_versions._check_package_version(package, TOKEN)

        # Assert
        self.assertEqual(entry["state"], "outdated")
        self.assertEqual(entry["published_version"], INITIAL_VERSION)

    def test_check_package_version_when_package_is_new(self) -> None:
        # Arrange
        package_dir = Path("/tmp/workflows") / WORKFLOW_NAME
        package = workflow_package_versions.WorkflowPackage(
            workflow_name=WORKFLOW_NAME,
            package_dir=package_dir,
            package_json_path=package_dir / "package.json",
            package_name=WORKFLOW_PACKAGE_NAME,
            version=INITIAL_VERSION,
            published_files=PUBLISHED_FILES,
        )

        with (
            mock.patch.object(
                workflow_package_versions,
                "_read_published_version",
                return_value=None,
            ),
        ):
            # Act
            entry = workflow_package_versions._check_package_version(package, TOKEN)

        # Assert
        self.assertEqual(entry["state"], "new")
        self.assertEqual(entry["published_version"], "")


if __name__ == "__main__":
    unittest.main()

