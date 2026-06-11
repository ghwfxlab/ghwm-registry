# ghwm-marketplace

A marketplace repository for ghwm (GitHub Workflow Manager).

This repository contains:
- **Astro UI (`src/ui/`)**: The marketplace UI build with Astro.
- **Scripts & Automations (`src/scripts/`)**: Various helper scripts used for scraping and fetching data.

## Repository Setup

We use a `Makefile` at the root of the repository to manage tasks across different directories.

### Available Makefile Commands

- **Setup Dependencies**: Install all package dependencies (Astro UI dependencies).
  ```bash
  make setup
  ```

- **Run Dev Server**: Run the Astro local development server.
  ```bash
  make dev
  ```

- **Production Build**: Build static assets for production deployment.
  ```bash
  make build
  ```

- **Preview Build**: Preview the built production assets locally.
  ```bash
  make preview
  ```

- **Clean Project**: Clean up dependencies and build artifacts.
  ```bash
  make clean
  ```

## Repository Structure

- `src/ui/`: Contains the Astro website marketplace frontend.
- `src/scripts/`: Place for scraper and backend automation scripts.

