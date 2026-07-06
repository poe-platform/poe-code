# Testing

Use the smallest command that proves the change.

## Unit and Type Checks

```sh
npm run test -- <path-or-pattern>
npm run lint
npm run typecheck
```

Prefer targeted package tests while iterating. Broaden to root checks when the change crosses package boundaries.

## CLI Spot Checks

Run the development CLI directly:

```sh
npm run dev -- <command> <args>
npm run dev -- --help
```

For visual CLI changes, capture a screenshot and inspect it:

```sh
npm run screenshot-poe-code -- --help
npm run screenshot-poe-code -- <command> --help
```

Do not commit screenshot tests for ad hoc visual checks.

## Agent Definition Checks

When changing agent definitions or spawn behavior, use the real test command:

```sh
npm run dev -- test <agent>
```

## E2E

Run E2E when the change touches configure/spawn/runtime behavior:

```sh
npm run e2e:verbose
```

See [development/e2e.md](development/e2e.md) for backend selection and local setup.

## GitHub Workflows

Do not write unit tests for workflow YAML. Lint workflows instead:

```sh
npm run lint:workflows
```

Optional local execution with `act`:

```sh
brew install act
act --list
act <event> -e <payload> --secret-file .secrets.act
```

Use `.secrets.act` only for local runs:

```sh
POE_API_KEY=test
GITHUB_TOKEN=test
```

If `act` tries to authenticate public action clones with the placeholder token, remove `GITHUB_TOKEN=test` or use a real token.
