#!/usr/bin/env bash
set -e

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
      IFS='.' read -r major minor patch <<< "$old_version"
      new_patch=$((patch + 1))
      new_version="${major}.${minor}.${new_patch}"
      sed -i "s/\"version\": \"$old_version\"/\"version\": \"$new_version\"/" "$dir/package.json"
    fi
  fi
done
