# Scripts and Automations

This folder is designated for various smaller automations, scraper scripts, and data fetching utilities that will be used to gather marketplace data.

## Getting Started

To add a scraper or automation script:
1. Place your script file here (e.g., `src/scripts/scrape-data.js` or `src/scripts/fetch-github-info.py`).
2. Add any script-specific dependencies to a `package.json` if they are Node.js-based, or specify a virtual environment/requirements file for Python.
3. Keep the scripts decoupled from the UI (`src/ui`) so they can run independently or be executed via CRON/CI/CD pipelines.
