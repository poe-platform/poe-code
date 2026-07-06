# Development

## Run Locally

Use the development CLI without rebuilding:

```sh
npm run dev -- <command> <args>
npm run dev -- --help
```

Install a locally built package globally when you need release-like behavior:

```sh
npm run install-local-package
poe-code --version
```

Local builds show a `local build` badge.

## Checks

```sh
npm run test -- <path-or-pattern>
npm run lint
npm run typecheck
npm run lint:packages
```

Use targeted tests while iterating. Broaden to root checks for cross-package changes.

## E2E

E2E requires a valid API key plus backend prerequisites. Local runs default to `sandbox`; CI defaults to `env`.

```sh
npm run e2e
npm run e2e:verbose
E2E_BACKEND=env npm run e2e
E2E_BACKEND=podman E2E_PODMAN_IMAGE=poe-code-e2e:local npm run e2e
```

Cleanup:

```sh
npm run e2e:cleanup
npm run e2e:cache:clear
```

See [docs/development/e2e.md](docs/development/e2e.md) for backend details.

## Local Poe API

Point commands at a local Poe-compatible API:

```sh
POE_BASE_URL=http://localhost:8000/__proxy__/poe/v1 npm run dev -- configure claude
```
