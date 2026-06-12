#!/usr/bin/env python3
"""Validate and patch workflow package versions against GitHub Packages."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REGISTRY_URL = "https://npm.pkg.github.com"
VERSION_PATTERN = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


@dataclass(frozen=True)
class WorkflowPackage:
    """A publishable workflow package."""

    workflow_name: str
    package_dir: Path
    package_json_path: Path
    package_name: str
    version: str
    published_files: tuple[str, ...]

    def tracks_path(self, relative_path: str) -> bool:
        """Return whether a changed path affects the published package."""
        if relative_path == "package.json":
            return True

        for published_path in self.published_files:
            if published_path.endswith("/"):
                prefix = published_path.rstrip("/")
                if relative_path == prefix or relative_path.startswith(f"{prefix}/"):
                    return True
                continue

            if relative_path == published_path:
                return True

        return False


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _run_git(args: list[str], repo_root: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        check=False,
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed:\n{result.stderr.strip()}")
    return result.stdout


def _staged_paths(repo_root: Path) -> list[str]:
    output = _run_git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"], repo_root)
    return [line for line in output.splitlines() if line]


def _range_paths(repo_root: Path, *, base_ref: str, head_ref: str) -> list[str]:
    merge_base = _run_git(["merge-base", base_ref, head_ref], repo_root).strip()
    if not merge_base:
        raise RuntimeError(f"Could not resolve a merge-base between {base_ref} and {head_ref}.")

    output = _run_git(
        ["diff", "--name-only", "--diff-filter=ACMR", f"{merge_base}...{head_ref}"],
        repo_root,
    )
    return [line for line in output.splitlines() if line]


def _parse_release_version(raw_version: str) -> tuple[int, int, int]:
    match = VERSION_PATTERN.fullmatch(raw_version)
    if match is None:
        raise ValueError(
            f"Unsupported workflow package version '{raw_version}'. Use MAJOR.MINOR.PATCH versions."
        )
    major, minor, patch = match.groups()
    return (int(major), int(minor), int(patch))


def _next_patch_version(raw_version: str) -> str:
    major, minor, patch = _parse_release_version(raw_version)
    return f"{major}.{minor}.{patch + 1}"


def _load_workflow_package(repo_root: Path, workflow_name: str) -> WorkflowPackage:
    package_dir = repo_root / "workflows" / workflow_name
    package_json_path = package_dir / "package.json"
    if not package_json_path.is_file():
        raise FileNotFoundError(f"Workflow package metadata not found: workflows/{workflow_name}/package.json")

    package_data = json.loads(package_json_path.read_text(encoding="utf-8"))
    package_name = package_data.get("name")
    version = package_data.get("version")
    files = package_data.get("files")

    if not isinstance(package_name, str) or not package_name:
        raise ValueError(f"workflows/{workflow_name}/package.json must define a non-empty string 'name'.")
    if not isinstance(version, str) or not version:
        raise ValueError(f"workflows/{workflow_name}/package.json must define a non-empty string 'version'.")
    if not isinstance(files, list) or any(not isinstance(item, str) or not item for item in files):
        raise ValueError(
            f"workflows/{workflow_name}/package.json must define a 'files' array of non-empty strings."
        )

    return WorkflowPackage(
        workflow_name=workflow_name,
        package_dir=package_dir,
        package_json_path=package_json_path,
        package_name=package_name,
        version=version,
        published_files=tuple(files),
    )


def _get_workflow_name_from_path(changed_path: str) -> str | None:
    path = Path(changed_path)
    if len(path.parts) >= 3 and path.parts[0] == "workflows":
        return path.parts[1]
    return None


def _changed_packages_from_paths(repo_root: Path, changed_paths: list[str]) -> list[WorkflowPackage]:
    packages_by_name: dict[str, WorkflowPackage] = {}
    publishable: dict[str, WorkflowPackage] = {}
    for changed_path in changed_paths:
        workflow_name = _get_workflow_name_from_path(changed_path)
        if workflow_name is None:
            continue

        package = packages_by_name.get(workflow_name)
        if package is None:
            package = _load_workflow_package(repo_root, workflow_name)
            packages_by_name[workflow_name] = package

        path = Path(changed_path)
        relative_path = Path(*path.parts[2:]).as_posix()
        if package.tracks_path(relative_path):
            publishable[workflow_name] = package

    return [publishable[name] for name in sorted(publishable)]


def _gh_cli_token() -> str | None:
    if shutil.which("gh") is None:
        return None

    result = subprocess.run(
        ["gh", "auth", "token"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode == 0:
        token = result.stdout.strip()
        if token:
            return token

    return None


def _github_token() -> str | None:
    return _gh_cli_token() or os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")


def _read_published_version(package_name: str, token: str) -> str | None:
    env = os.environ.copy()
    env["NODE_AUTH_TOKEN"] = token

    try:
        result = subprocess.run(
            ["npm", "view", package_name, "version", "--json", "--registry", REGISTRY_URL],
            check=False,
            capture_output=True,
            text=True,
            env=env,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("npm is required to query GitHub Packages. Install Node.js and npm.") from exc

    combined_output = "\n".join(part for part in (result.stdout.strip(), result.stderr.strip()) if part)
    if result.returncode == 0:
        output = result.stdout.strip()
        if not output or output == "null":
            return None

        parsed = json.loads(output)
        if isinstance(parsed, list):
            if not parsed:
                return None
            return str(parsed[-1])
        if isinstance(parsed, str):
            return parsed
        raise RuntimeError(f"Unexpected npm metadata response for {package_name}: {output}")

    if "E404" in combined_output or "404 Not Found" in combined_output or "is not in this registry" in combined_output:
        return None

    if (
        "ENEEDAUTH" in combined_output
        or "E401" in combined_output
        or "401 Unauthorized" in combined_output
        or "authentication token not provided" in combined_output.lower()
    ):
        raise RuntimeError(
            "GitHub Packages authentication is required. Run `gh auth login` or set GH_TOKEN/GITHUB_TOKEN."
        )

    raise RuntimeError(f"Failed to query {package_name} from GitHub Packages:\n{combined_output}")


def _write_package_version(package: WorkflowPackage, new_version: str) -> None:
    package_data = json.loads(package.package_json_path.read_text(encoding="utf-8"))
    package_data["version"] = new_version
    package.package_json_path.write_text(f"{json.dumps(package_data, indent=2)}\n", encoding="utf-8")


def _stage_path(repo_root: Path, path: Path) -> None:
    result = subprocess.run(
        ["git", "add", "--", str(path.relative_to(repo_root))],
        check=False,
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git add failed for {path.relative_to(repo_root)}:\n{result.stderr.strip()}")


def _patch_package(repo_root: Path, package: WorkflowPackage, published_version: str) -> str:
    new_version = _next_patch_version(published_version)
    _write_package_version(package, new_version)
    _stage_path(repo_root, package.package_json_path)
    return new_version


def _write_report(report_path: Path | None, report: dict[str, object]) -> None:
    if report_path is None:
        return
    report_path.write_text(f"{json.dumps(report, indent=2)}\n", encoding="utf-8")


def fix_staged(repo_root: Path) -> int:
    changed_packages = _changed_packages_from_paths(repo_root, _staged_paths(repo_root))
    if not changed_packages:
        print("No changed published workflow packages detected in staged changes.")
        return 0

    token = _github_token()
    if token is None:
        raise RuntimeError(
            "Cannot auto-bump workflow package versions without GitHub Packages auth. "
            "Run `gh auth login` or set GH_TOKEN/GITHUB_TOKEN."
        )

    patched = False
    for package in changed_packages:
        _parse_release_version(package.version)
        published_version = _read_published_version(package.package_name, token)

        if published_version is None:
            print(f"{package.package_name}: no published version found; keeping {package.version}.")
            continue

        if _parse_release_version(package.version) > _parse_release_version(published_version):
            print(
                f"{package.package_name}: local version {package.version} is ahead of published {published_version}."
            )
            continue

        new_version = _patch_package(repo_root, package, published_version)
        patched = True
        print(
            f"Patched {package.package_name} from {package.version} to {new_version} "
            f"because the published version is {published_version}."
        )

    if patched:
        print("Workflow package versions were updated. Review the changes and run `git commit` again.")
        return 1

    return 0


def _check_package_version(package: WorkflowPackage, token: str) -> dict[str, str]:
    _parse_release_version(package.version)
    published_version = _read_published_version(package.package_name, token)

    state = "new"
    entry = {
        "workflow": package.workflow_name,
        "package_name": package.package_name,
        "local_version": package.version,
        "published_version": published_version or "",
        "state": state,
    }

    if published_version is not None:
        state = "ok"
        if _parse_release_version(package.version) <= _parse_release_version(published_version):
            state = "outdated"
        entry["published_version"] = published_version
        entry["state"] = state

    return entry


def _check_packages(
    changed_packages: list[WorkflowPackage], token: str
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    checked: list[dict[str, str]] = []
    outdated: list[dict[str, str]] = []

    for package in changed_packages:
        entry = _check_package_version(package, token)
        checked.append(entry)
        if entry["state"] == "outdated":
            outdated.append(entry)

    return checked, outdated


def check_range(repo_root: Path, *, base_ref: str, head_ref: str, report_path: Path | None) -> int:
    changed_packages = _changed_packages_from_paths(repo_root, _range_paths(repo_root, base_ref=base_ref, head_ref=head_ref))
    report: dict[str, object] = {"checked": [], "outdated": []}

    if not changed_packages:
        print("No changed published workflow packages detected in the pull request diff.")
        _write_report(report_path, report)
        return 0

    token = _github_token()
    if token is None:
        raise RuntimeError(
            "Cannot validate workflow package versions without GitHub Packages auth. "
            "Set GH_TOKEN or GITHUB_TOKEN in CI."
        )

    checked, outdated = _check_packages(changed_packages, token)

    report["checked"] = checked
    report["outdated"] = outdated
    _write_report(report_path, report)

    if not outdated:
        print("All changed workflow package versions are ahead of the latest published versions.")
        return 0

    print("Changed workflow packages must use versions higher than the latest published version:")
    for entry in outdated:
        print(
            f"- {entry['package_name']}: local {entry['local_version']} is not ahead of published "
            f"{entry['published_version']}"
        )
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    subcommands.add_parser("fix-staged", help="Patch changed staged workflow package versions when needed.")

    check_range_parser = subcommands.add_parser(
        "check-range",
        help="Validate changed workflow package versions against the latest published packages.",
    )
    check_range_parser.add_argument("--base-ref", required=True, help="Base ref used to build the diff range.")
    check_range_parser.add_argument("--head-ref", default="HEAD", help="Head ref used to build the diff range.")
    check_range_parser.add_argument(
        "--report-path",
        type=Path,
        default=None,
        help="Optional JSON report output path for CI comment steps.",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    repo_root = _repo_root()

    try:
        if args.command == "fix-staged":
            return fix_staged(repo_root)
        if args.command == "check-range":
            return check_range(
                repo_root,
                base_ref=args.base_ref,
                head_ref=args.head_ref,
                report_path=args.report_path,
            )
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
