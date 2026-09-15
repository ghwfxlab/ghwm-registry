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
| `npm run sync-catalog`    | Sync workflow frontmatter to the D1 catalog API  |
| `npm test`                | Run UI and API client unit tests                 |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

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

- Synchronizing workflow catalog to Cloudflare D1:

  ```sh
  WORKER_AUTH_TOKEN=<auth-token> npm run sync-catalog
  ```

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
