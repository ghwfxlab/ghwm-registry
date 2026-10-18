#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH=${1:-main}

# Make sure we have the remote tracking branch
if ! git rev-parse "origin/$BASE_BRANCH" >/dev/null 2>&1; then
  echo "Fetching origin/$BASE_BRANCH..."
  git fetch origin "$BASE_BRANCH" || true
fi

# Find workflows that changed on this branch compared to the base branch
CHANGED_DIRS=$(git diff --name-only "origin/$BASE_BRANCH" | grep '^workflows/' | cut -d/ -f1,2 | sort -u || true)

for dir in $CHANGED_DIRS; do
  if [ -f "$dir/package.json" ]; then
    # Check if package.json was ALREADY modified on this branch
    if ! git diff --name-only "origin/$BASE_BRANCH" -- "$dir/package.json" | grep -q 'package.json'; then
      echo "Bumping package version in $dir"
      old_version=$(grep '"version":' "$dir/package.json" | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')
      if [[ ! "$old_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
        echo "Skipping $dir: unsupported version '$old_version'" >&2
        continue
      fi
      new_version="${BASH_REMATCH[1]}.${BASH_REMATCH[2]}.$((BASH_REMATCH[3] + 1))"
      sed -i -E "s/\"version\": *\"$old_version\"/\"version\": \"$new_version\"/" "$dir/package.json"
      grep -q "\"version\": \"$new_version\"" "$dir/package.json" || {
        echo "Failed to bump $dir" >&2
        exit 1
      }
    fi
  fi
done
