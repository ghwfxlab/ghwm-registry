# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its filename.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run dev:prod-api`    | Starts dev server targeting production API       |
| `npm run dev:test-api`    | Starts dev server targeting the test API         |
| `npm run build`           | Build production site with production API data   |
| `npm run build:prod-api`  | Build site targeting the production API          |
| `npm run build:test-api`  | Build site targeting the test API                |
| `npm test`                | Run UI and API client unit tests                 |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 📚 Synced Docs

The manifest and frontmatter reference pages under `/docs` are not stored in this repository. At build
time they are fetched from the latest `ghwm` release tag, and the build fails if that is not possible
(it never falls back to stale docs). "Writing a package" is rendered from the root `CONTRIBUTING.md`.

| Variable        | Purpose                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`  | Avoids GitHub API rate limits when resolving the latest release (set in CI)    |
| `GHWM_DOCS_TAG` | Pin the `ghwm` tag the docs are fetched from, instead of the latest release    |
| `GHWM_DOCS_DIR` | Read the docs from a local `ghwm` checkout instead (offline work, doc authors) |

```sh
GHWM_DOCS_DIR=~/src/ghwm/main npm run dev
```

## ⚙️ Environment Configuration

To configure the API endpoint used for fetching workflow usage statistics, set `PUBLIC_API_URL`:

- Copy `.env.example` to `.env`:

  ```sh
  cp .env.example .env
  ```

- Default production API endpoint:

  ```sh
  PUBLIC_API_URL=https://ghwm-deployment-prd.ghwfxlab.workers.dev npm run dev
  ```

- Test API endpoint:

  ```sh
  PUBLIC_API_URL=https://ghwm-deployment-tst.ghwfxlab.workers.dev npm run dev
  ```

## ⚡ Live Metadata

Pages are built statically, but the Worker (`ghwm-deployment`) keeps D1 current with GitHub, so `/registry/` and
`/workflows/<name>/` read it in the browser (`src/lib/liveApi.ts`) instead of waiting for a rebuild:

- `/workflows/<name>/`: calls `GET {PUBLIC_API_URL}/workflows/:name`. The Worker answers from D1 and, when its metadata is older
  than 10 minutes, refreshes the row from the workflow's own source repository (ETag-conditional, one caller per
  workflow per interval). The page patches the version, title and description and shows a "checked N min ago" label;
  if a refresh was triggered it reads once more after 3 seconds.
- `/registry/`: calls `GET {PUBLIC_API_URL}/catalog` (a plain D1 read) and merges it over the build-time rows, including
  install counts and workflows from other registries that were added after the last build.
- If the Worker is unreachable, the build-time values stay. Responses are cached in `sessionStorage` for 60 seconds.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
