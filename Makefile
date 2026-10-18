.DEFAULT_GOAL := help

# Configuration
UI_DIR = src/ui
TEXTLINT_CONFIG ?= .github/linters/.textlintrc
TEXTLINT_IGNORE ?= .github/linters/.textlintignore
SHELL := /usr/bin/env bash
.SHELLFLAGS := -eu -o pipefail -c
PROD_API_URL ?= https://ghwm-deployment-prd.ghwfxlab.workers.dev
TEST_API_URL ?= https://ghwm-deployment-tst.ghwfxlab.workers.dev
TARGET_API ?= prod
VENV_DIR ?= .venv
PYTHON ?= $(if $(VIRTUAL_ENV),python3,$(VENV_DIR)/bin/python3)
PRE_COMMIT ?= $(if $(shell command -v pre-commit 2>/dev/null),pre-commit,"$(PYTHON)" -m pre_commit)

.PHONY: help setup dev dev-prod-api dev-test-api build build-prod-api build-test-api preview clean lang lang-fix check-script-env script-tests ui-tests setup-precommit precommit super-linter super-linter-fix

help:
	@echo "Available commands:"
	@echo ""
	@echo "development targets:"
	@echo "  setup            - Install dependencies for the Astro UI in $(UI_DIR)"
	@echo "  dev              - Start the Astro UI development server (supports TARGET_API=prod|test)"
	@echo "  dev-prod-api     - Start the Astro UI development server targeting prod API ($(PROD_API_URL))"
	@echo "  dev-test-api     - Start the Astro UI development server targeting test API ($(TEST_API_URL))"
	@echo "  build            - Build the Astro UI for production (supports TARGET_API=prod|test)"
	@echo "  build-prod-api   - Build the Astro UI for production targeting prod API ($(PROD_API_URL))"
	@echo "  build-test-api   - Build the Astro UI for production targeting test API ($(TEST_API_URL))"
	@echo "  preview          - Preview the production build locally"
	@echo "  clean            - Clean build outputs and temporary files"
	@echo ""
	@echo "quality targets:"
	@echo "  lang             - Run textlint on prose"
	@echo "  lang-fix         - Run textlint with --fix"
	@echo "  script-tests     - Run tests for repository helper scripts"
	@echo "  ui-tests         - Run UI unit tests"
	@echo "  setup-precommit  - Install pre-commit hooks"
	@echo "  precommit        - Run pre-commit on all files"
	@echo "  super-linter     - Run super-linter via Docker"
	@echo "  super-linter-fix - Run super-linter with auto-fix"

setup:
	@echo "Installing dependencies for Astro UI in $(UI_DIR)..."
	npm install --prefix $(UI_DIR)

dev: setup
	@if [ "$$(echo "$${TARGET_API:-}" | tr '[:upper:]' '[:lower:]')" = "test" ]; then \
		echo "Targeting test API ($(TEST_API_URL))..."; \
		PUBLIC_API_URL="$(TEST_API_URL)" npm run dev --prefix $(UI_DIR); \
	elif [ "$$(echo "$${TARGET_API:-}" | tr '[:upper:]' '[:lower:]')" = "prod" ]; then \
		echo "Targeting production API ($(PROD_API_URL))..."; \
		PUBLIC_API_URL="$(PROD_API_URL)" npm run dev --prefix $(UI_DIR); \
	elif [ -n "$${API_URL:-}" ]; then \
		echo "Targeting custom API ($$API_URL)..."; \
		PUBLIC_API_URL="$$API_URL" npm run dev --prefix $(UI_DIR); \
	elif [ -n "$${PUBLIC_API_URL:-}" ]; then \
		echo "Targeting API ($$PUBLIC_API_URL)..."; \
		PUBLIC_API_URL="$$PUBLIC_API_URL" npm run dev --prefix $(UI_DIR); \
	else \
		echo "Starting development server targeting production API ($(PROD_API_URL))..."; \
		PUBLIC_API_URL="$(PROD_API_URL)" npm run dev --prefix $(UI_DIR); \
	fi

dev-prod-api: setup
	@echo "Targeting production API ($(PROD_API_URL))..."
	PUBLIC_API_URL="$(PROD_API_URL)" npm run dev --prefix $(UI_DIR)

dev-test-api: setup
	@echo "Targeting test API ($(TEST_API_URL))..."
	PUBLIC_API_URL="$(TEST_API_URL)" npm run dev --prefix $(UI_DIR)

build: setup
	@if [ "$$(echo "$${TARGET_API:-}" | tr '[:upper:]' '[:lower:]')" = "test" ]; then \
		echo "Targeting test API ($(TEST_API_URL))..."; \
		PUBLIC_API_URL="$(TEST_API_URL)" npm run build --prefix $(UI_DIR); \
	elif [ "$$(echo "$${TARGET_API:-}" | tr '[:upper:]' '[:lower:]')" = "prod" ]; then \
		echo "Targeting production API ($(PROD_API_URL))..."; \
		PUBLIC_API_URL="$(PROD_API_URL)" npm run build --prefix $(UI_DIR); \
	elif [ -n "$${API_URL:-}" ]; then \
		echo "Targeting custom API ($$API_URL)..."; \
		PUBLIC_API_URL="$$API_URL" npm run build --prefix $(UI_DIR); \
	elif [ -n "$${PUBLIC_API_URL:-}" ]; then \
		echo "Targeting API ($$PUBLIC_API_URL)..."; \
		PUBLIC_API_URL="$$PUBLIC_API_URL" npm run build --prefix $(UI_DIR); \
	else \
		echo "Building Astro UI for production targeting production API ($(PROD_API_URL))..."; \
		PUBLIC_API_URL="$(PROD_API_URL)" npm run build --prefix $(UI_DIR); \
	fi

build-prod-api: setup
	@echo "Building Astro UI for production targeting production API ($(PROD_API_URL))..."
	PUBLIC_API_URL="$(PROD_API_URL)" npm run build --prefix $(UI_DIR)

build-test-api: setup
	@echo "Building Astro UI for production targeting test API ($(TEST_API_URL))..."
	PUBLIC_API_URL="$(TEST_API_URL)" npm run build --prefix $(UI_DIR)

preview:
	@echo "Previewing production build..."
	npm run preview --prefix $(UI_DIR)

clean:
	@echo "Cleaning build artifacts and dependencies..."
	rm -rf $(UI_DIR)/dist
	rm -rf $(UI_DIR)/.astro
	rm -rf $(UI_DIR)/node_modules
	rm -rf node_modules
	rm -rf $(VENV_DIR)

check-lang-env:
	@echo "[check-lang-env] Ensuring Node.js environment for textlint..."
	@which npx >/dev/null 2>&1 || (echo "[check-lang-env] ❌ npx not found; install Node.js" && exit 1)
	@npm install --no-save textlint textlint-rule-terminology textlint-filter-rule-comments >/dev/null 2>&1
	@echo "[check-lang-env] OK"

lang: check-lang-env
	@echo "[lang] Running textlint..."
	@npx textlint --config $(TEXTLINT_CONFIG) --ignore-path $(TEXTLINT_IGNORE) .

lang-fix: check-lang-env
	@echo "[lang-fix] Running textlint --fix..."
	@npx textlint --config $(TEXTLINT_CONFIG) --ignore-path $(TEXTLINT_IGNORE) . --fix

check-script-env:
	@echo "[check-script-env] Ensuring Python environment for helper scripts..."
	@which python3 >/dev/null 2>&1 || (echo "[check-script-env] ❌ python3 not found; install Python" && exit 1)
	@if ! command -v "$(PYTHON)" >/dev/null 2>&1; then \
		if [ -z "$${VIRTUAL_ENV:-}" ] && [ "$(PYTHON)" = "$(VENV_DIR)/bin/python3" ]; then \
			echo "[check-script-env] Creating virtual environment in $(VENV_DIR)..."; \
			python3 -m venv "$(VENV_DIR)"; \
		else \
			echo "[check-script-env] ❌ Python interpreter '$(PYTHON)' not found" && exit 1; \
		fi; \
	fi
	@"$(PYTHON)" -c "import yaml" >/dev/null 2>&1 || ( \
		echo "[check-script-env] Installing dependencies from scripts/requirements.txt..." && \
		"$(PYTHON)" -m pip install -q -r scripts/requirements.txt \
	)
	@echo "[check-script-env] OK"

script-tests: check-script-env
	@echo "[script-tests] Running helper script tests..."
	@PYTHONDONTWRITEBYTECODE=1 "$(PYTHON)" scripts/test_workflow_package_versions.py -v
	@PYTHONDONTWRITEBYTECODE=1 "$(PYTHON)" scripts/test_evaluate_release_paths.py -v

ui-tests: setup
	@echo "[ui-tests] Running UI unit tests..."
	@npm test --prefix $(UI_DIR)

setup-precommit: check-script-env
	@echo "[setup-precommit] Installing pre-commit hooks..."
	@command -v pre-commit >/dev/null 2>&1 || "$(PYTHON)" -c "import pre_commit" >/dev/null 2>&1 || ( \
		echo "[setup-precommit] Installing pre-commit via $(PYTHON)..." && \
		"$(PYTHON)" -m pip install -q pre-commit \
	)
	@$(PRE_COMMIT) install --install-hooks

precommit:
	@echo "[precommit] Running pre-commit..."
	@$(PRE_COMMIT) run --all-files

super-linter:
	@echo "[super-linter] Running super-linter via Docker..."
	@GIT_DIR=$$(git rev-parse --path-format=absolute --git-common-dir) && \
	docker run \
		--platform linux/amd64 \
		-e RUN_LOCAL=true \
		-e DEFAULT_BRANCH=main \
		--env-file .github/super-linter.env \
		-v $(PWD):/tmp/lint \
		-v $$GIT_DIR:$$GIT_DIR \
		--rm \
		ghcr.io/super-linter/super-linter:slim-v9.0.0@sha256:7d0b4d3387deaac975e86e0787c7a05a25d530469b27d74c2b4599ab5800d9e4


super-linter-fix:
	@echo "[super-linter-fix] Running super-linter with auto-fix via Docker..."
	@GIT_DIR=$$(git rev-parse --path-format=absolute --git-common-dir) && \
	docker run \
		--platform linux/amd64 \
		-e RUN_LOCAL=true \
		-e DEFAULT_BRANCH=main \
		--env-file .github/super-linter.env \
		--env-file .github/super-linter-fix.env \
		-v $(PWD):/tmp/lint \
		-v $$GIT_DIR:$$GIT_DIR \
		--rm \
		ghcr.io/super-linter/super-linter:slim-v9.0.0@sha256:7d0b4d3387deaac975e86e0787c7a05a25d530469b27d74c2b4599ab5800d9e4
