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

## Local Poe API

Point commands at a local Poe-compatible API:

```sh
POE_BASE_URL=http://localhost:8000/__proxy__/poe/v1 npm run dev -- configure claude
```
