#!/usr/bin/env python3
"""Automated tests for the external path filter evaluation script in auto-release.yaml."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = REPO_ROOT / "workflows" / "auto-release" / "auto-release.yaml"


def _extract_filter_script(yaml_path: Path) -> str:
    """Extracts the inline bash script from the 'Evaluate external path rules' step using PyYAML."""
    content = yaml_path.read_text(encoding="utf-8")
    data = yaml.safe_load(content)
    for step in data.get("jobs", {}).get("check-paths", {}).get("steps", []):
        if step.get("name") == "Evaluate external path rules":
            return step["run"]
    raise ValueError(f"Could not find 'Evaluate external path rules' step in {yaml_path}")


class EvaluateReleasePathsTests(unittest.TestCase):
    def _run_script(
        self,
        repo_dir: Path,
        *,
        before: str,
        sha: str,
    ) -> tuple[bool, str]:
        """Runs the bash evaluation script and returns (run_release, stdout)."""
        output_file = repo_dir / "github_output.txt"
        if output_file.exists():
            output_file.unlink()
        env = {
            **os.environ,
            "GITHUB_OUTPUT": str(output_file),
            "EVENT_BEFORE": before,
            "EVENT_SHA": sha,
        }
        script = _extract_filter_script(WORKFLOW_PATH)
        proc = subprocess.run(
            ["bash", "-s"],
            input=script,
            cwd=repo_dir,
            env=env,
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"Script failed with code {proc.returncode}:\n{proc.stderr}")

        if not output_file.exists():
            raise FileNotFoundError("Script did not write to GITHUB_OUTPUT")

        output_content = output_file.read_text(encoding="utf-8").strip()
        last_line = output_content.splitlines()[-1] if output_content else ""
        run_release = last_line == "run_release=true"
        return run_release, proc.stdout

    def _create_git_repo(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        repo_path = Path(temp_dir.name)

        subprocess.run(["git", "init", "-q"], cwd=repo_path, check=True)
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=repo_path, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo_path, check=True)
        return repo_path

    def _commit(self, repo_path: Path, message: str) -> str:
        subprocess.run(["git", "add", "."], cwd=repo_path, check=True)
        subprocess.run(["git", "commit", "-qm", message], cwd=repo_path, check=True)
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_path,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    def test_evaluate_paths_should_default_to_true_when_config_file_is_missing(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        (repo / "file.txt").write_text("hello", encoding="utf-8")
        sha = self._commit(repo, "initial commit")

        # Act
        run_release, stdout = self._run_script(repo, before="", sha=sha)

        # Assert
        self.assertTrue(run_release)
        self.assertIn("Config file not found, defaulting execution to true", stdout)

    def test_evaluate_paths_should_default_to_true_when_yaml_config_file_is_empty(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        config_dir = repo / ".github"
        config_dir.mkdir(parents=True)
        (config_dir / "auto-release.yaml").write_text("", encoding="utf-8")
        (repo / "file.txt").write_text("hello", encoding="utf-8")
        sha = self._commit(repo, "initial commit")

        # Act
        run_release, stdout = self._run_script(repo, before="", sha=sha)

        # Assert
        self.assertTrue(run_release)
        self.assertIn("No filter patterns defined", stdout)

    def test_evaluate_paths_should_default_to_true_when_yaml_config_has_only_comments(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        config_dir = repo / ".github"
        config_dir.mkdir(parents=True)
        (config_dir / "auto-release.yaml").write_text(
            "# Only comments\npaths:\n  # - src/**\n", encoding="utf-8"
        )
        (repo / "file.txt").write_text("hello", encoding="utf-8")
        sha = self._commit(repo, "initial commit")

        # Act
        run_release, stdout = self._run_script(repo, before="", sha=sha)

        # Assert
        self.assertTrue(run_release)
        self.assertIn("No filter patterns defined", stdout)

    def test_evaluate_paths_should_trigger_release_when_matching_files_changed_in_yaml_config(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        config_dir = repo / ".github"
        config_dir.mkdir(parents=True)
        (config_dir / "auto-release.yaml").write_text("paths:\n  - 'src/**'\n", encoding="utf-8")
        (repo / "init.txt").write_text("init", encoding="utf-8")
        before = self._commit(repo, "init")

        (repo / "src").mkdir()
        (repo / "src" / "app.py").write_text("print(1)", encoding="utf-8")
        sha = self._commit(repo, "update src")

        # Act
        run_release, stdout = self._run_script(repo, before=before, sha=sha)

        # Assert
        self.assertTrue(run_release)
        self.assertIn("src/app.py", stdout)

    def test_evaluate_paths_should_trigger_release_when_matching_files_changed_in_json_config(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        config_dir = repo / ".github"
        config_dir.mkdir(parents=True)
        (config_dir / "auto-release.json").write_text('{"paths": ["src/**"]}', encoding="utf-8")
        (repo / "init.txt").write_text("init", encoding="utf-8")
        before = self._commit(repo, "init")

        (repo / "src").mkdir()
        (repo / "src" / "index.ts").write_text("export const x = 1;", encoding="utf-8")
        sha = self._commit(repo, "update src")

        # Act
        run_release, stdout = self._run_script(repo, before=before, sha=sha)

        # Assert
        self.assertTrue(run_release)
        self.assertIn("src/index.ts", stdout)

    def test_evaluate_paths_should_skip_release_when_no_matching_files_changed(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        config_dir = repo / ".github"
        config_dir.mkdir(parents=True)
        (config_dir / "auto-release.yaml").write_text("paths:\n  - 'src/**'\n", encoding="utf-8")
        (repo / "init.txt").write_text("init", encoding="utf-8")
        before = self._commit(repo, "init")

        (repo / "docs").mkdir()
        (repo / "docs" / "guide.md").write_text("documentation", encoding="utf-8")
        sha = self._commit(repo, "update docs")

        # Act
        run_release, stdout = self._run_script(repo, before=before, sha=sha)

        # Assert
        self.assertFalse(run_release)
        self.assertIn("No matching paths changed", stdout)

    def test_evaluate_paths_should_trigger_release_when_earlier_commit_in_range_matches(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        config_dir = repo / ".github"
        config_dir.mkdir(parents=True)
        (config_dir / "auto-release.yaml").write_text("paths:\n  - 'src/**'\n", encoding="utf-8")
        (repo / "init.txt").write_text("init", encoding="utf-8")
        before = self._commit(repo, "init")

        # Earlier commit: modifies matching path
        (repo / "src").mkdir()
        (repo / "src" / "feature.ts").write_text("feature", encoding="utf-8")
        self._commit(repo, "code commit")

        # Later commit: docs only
        (repo / "README.md").write_text("new docs", encoding="utf-8")
        sha = self._commit(repo, "docs commit")

        # Act
        run_release, stdout = self._run_script(repo, before=before, sha=sha)

        # Assert
        self.assertTrue(run_release)
        self.assertIn("src/feature.ts", stdout)

    def test_evaluate_paths_should_trigger_release_when_initial_commit_matches_and_before_is_zeroes(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        config_dir = repo / ".github"
        config_dir.mkdir(parents=True)
        (config_dir / "auto-release.yaml").write_text("paths:\n  - 'src/**'\n", encoding="utf-8")
        (repo / "src").mkdir()
        (repo / "src" / "main.rs").write_text("fn main() {}", encoding="utf-8")
        sha = self._commit(repo, "first commit")

        # Act
        run_release, stdout = self._run_script(
            repo, before="0000000000000000000000000000000000000000", sha=sha
        )

        # Assert
        self.assertTrue(run_release)
        self.assertIn("src/main.rs", stdout)

    def test_evaluate_paths_should_match_language_patterns_when_evaluating_dotnet_rust_go_java_and_frontend(self) -> None:
        # Arrange
        repo = self._create_git_repo()
        config_dir = repo / ".github"
        config_dir.mkdir(parents=True)
        (config_dir / "auto-release.yaml").write_text(
            "paths:\n"
            "  # .NET\n"
            "  - 'src/**/*.cs'\n"
            "  - '*.sln'\n"
            "  - '**/*.csproj'\n"
            "  # Rust\n"
            "  - 'Cargo.toml'\n"
            "  - 'src/**/*.rs'\n"
            "  # Golang\n"
            "  - '**/*.go'\n"
            "  - 'go.mod'\n"
            "  # Java\n"
            "  - 'src/main/**'\n"
            "  - 'pom.xml'\n"
            "  # Frontend\n"
            "  - 'package.json'\n",
            encoding="utf-8",
        )
        (repo / "init.txt").write_text("init", encoding="utf-8")
        base = self._commit(repo, "init")

        # Act & Assert - Dotnet
        (repo / "src" / "api").mkdir(parents=True, exist_ok=True)
        (repo / "src" / "api" / "Controller.cs").write_text("class C {}", encoding="utf-8")
        dotnet_sha = self._commit(repo, "dotnet commit")
        run, stdout = self._run_script(repo, before=base, sha=dotnet_sha)
        self.assertTrue(run)
        self.assertIn("src/api/Controller.cs", stdout)

        # Act & Assert - Golang (root main.go matching **/*.go via :(glob))
        (repo / "main.go").write_text("package main", encoding="utf-8")
        go_sha = self._commit(repo, "golang commit")
        run, stdout = self._run_script(repo, before=dotnet_sha, sha=go_sha)
        self.assertTrue(run)
        self.assertIn("main.go", stdout)

        # Act & Assert - Rust
        (repo / "Cargo.toml").write_text("[package]", encoding="utf-8")
        rust_sha = self._commit(repo, "rust commit")
        run, stdout = self._run_script(repo, before=go_sha, sha=rust_sha)
        self.assertTrue(run)
        self.assertIn("Cargo.toml", stdout)

        # Act & Assert - Java
        (repo / "pom.xml").write_text("<project></project>", encoding="utf-8")
        java_sha = self._commit(repo, "java commit")
        run, stdout = self._run_script(repo, before=rust_sha, sha=java_sha)
        self.assertTrue(run)
        self.assertIn("pom.xml", stdout)

        # Act & Assert - Frontend
        (repo / "package.json").write_text("{}", encoding="utf-8")
        fe_sha = self._commit(repo, "frontend commit")
        run, stdout = self._run_script(repo, before=java_sha, sha=fe_sha)
        self.assertTrue(run)
        self.assertIn("package.json", stdout)

        # Act & Assert - Doc change (should NOT trigger)
        (repo / "CHANGELOG.md").write_text("v1.0", encoding="utf-8")
        doc_sha = self._commit(repo, "doc commit")
        run, stdout = self._run_script(repo, before=fe_sha, sha=doc_sha)
        self.assertFalse(run)
        self.assertIn("No matching paths changed", stdout)


if __name__ == "__main__":
    unittest.main()
