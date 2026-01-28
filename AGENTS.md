# Instructions

## Core Principles

NEVER EVER REVERT CHANGES THAT YOU DIDN'T MAKE

- TDD is a MUST (only for code changes, not for configs)
- SOLID
- YAGNI, KISS

When adding a new provider, the author should be creating 1 provider file, everything else is automatic, derived from the provider config. We can't have any if/case statements that will branch depending on the provider.

## Bad habits that I want to avoid

- Functions that do nothing just proxy to another functions are not allowed
- Do not overuse constants, only for "business logic" not for things like concatenate two constants
- The tests should not be increasing complexity of the code.

## github workflows

Do NOT write unit tests for github workflows
Use `npm run lint:workflows`

## Testing file changes

- Tests must not create files - use `memfs` library to test changes in memory
- Tests must not query LLM - use abstraction to mock this reliably across all files

## Commits

- Commit every atomic change, once the tests are green - npm run test, npm run lint
- Follow Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`).
- Keep subjects imperative and under 72 characters.
- Commit specific files that you edited, never blanket git add -A

## Release

- Beta release: Push to `beta` branch → publishes `poe-code@beta`
- Stable release: Push to `main` branch → publishes `poe-code@latest`
- Promote beta to stable: Run "Promote Beta to Stable" workflow from GitHub Actions UI

After a stable release, the `beta` branch is automatically rebased onto `main`.

## Configure commands / Providers

Regexes are not allowed. When modifying existing files, you must parse them and deep merge them. If you run into unsupported file e.g. yaml, install parser library.

The Providers should have as little as possible boilerplate, keep them simple, declarative. They should not know anything about logging, dry run.

Providers must be declarative and minimal: you are not allowed to add repeated information that can be inferred from existing config.

## Readme

You are not allowed to add anything to readme without user's permission. Upon feature completion, ask user whether readme should be updated.

## Planning

Planning docs must be in `docs` folder

## E2E Testing

`npm run dev -- <command> <args>`

## CLI vs SDK

When implementing features e.g. new cli args, make sure to keep parity with SDK and expose the same args.
