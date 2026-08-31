# Instructions

## Core Principles

NEVER EVER REVERT CHANGES THAT YOU DIDN'T MAKE

- TDD is a MUST (only for code changes, not for configs)
- SOLID
- YAGNI, KISS

When adding a new provider, the author should be creating 1 provider file, everything else is automatic, derived from the provider config. We can't have any if/case statements that will branch depending on the provider.

We are not doing branches unless requested. Everything happens on main and we push straight to main (when requested).

ALWAYS monitor the build after push until the release is successful. 

## Bad habits that I want to avoid

- Functions that do nothing just proxy to another functions are not allowed
- Do not overuse constants, only for "business logic" not for things like concatenate two constants
- The tests should not be increasing complexity of the code.
- When you detect other changes, ignore them, never ask user what to do.

## Packages

Prefer adding code to specific packages e.g. `agent-spawn`. The core should be lightweight and only wire packages and expose public apis, sdk, cli, no real logic.

### Rules

- Package must have own readme
  - includes all env variables exposed
  - includes all config options via config

## github workflows

Do NOT write unit tests for github workflows
Use `npm run lint:workflows`

## Commits

- Follow Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`).
- Commit specific files that you edited, never blanket git add -A
- Do not add yourself as co-author!
- Do not commit files that are in gitignore
- Never use --no-verify on either push or commit. You should figure out the issue.
- Relevant plans belongs to commits

## Release

- Stable release: Push to `main` branch → publishes `poe-code@latest`

Releases are always done on github, not locally

See NPM_PUBLISHING.md

## Configure commands / Providers

Regexes are not allowed. When modifying existing files, you must parse them and deep merge them. If you run into unsupported file e.g. yaml, install parser library.

The Providers should have as little as possible boilerplate, keep them simple, declarative. They should not know anything about logging, dry run.

Providers must be declarative and minimal: you are not allowed to add repeated information that can be inferred from existing config.

A provider may define an optional `spawn(context, options)` conversation function — the imperative hook that actually runs the agent (e.g. `gemini-cli`). Prefer the declarative `agent-spawn` config; reach for `spawn` only when the declarative path can't express the run.

## Testing

### Maintained build and test routes

- Use `npm run build` for the normal workspace build and root suffix stages; use `npm run build:workspaces -- --workspace=<exact-name>` only for an explicitly selected workspace build closure.
- Use `npm test` for root and every declared workspace unit task, including required build dependencies and native npm pre/event/post scripts. Root-only `npm run test:unit` is not a normal pre-push or CI substitute.
- Keep execution uncached and derive task membership/dependency closure from maintained declarations; do not replace them with fixed task counts or a root-plus-Bash shortcut.
- In unit mode, keep caller-supplied `SAFE_BASH_TEST_RG`, `SAFEJS_LOCAL_ROOT`, `S3_HTTP_EXPORTS_REVISION` and `FULL_GATE_ROOT` scoped to the actual virtual-bash workspace unit task. Do not synthesize optional profiles or count unavailable cases as passes.

### Unit Testing - speed is crucial

Any tests that takes longer shouldn't exist. Either mock slow dependencies or rewrite/remove the test.

### Unit Testing - file changes

- Tests must not create files - use `memfs` library to test changes in memory.
  - Exception is snapshots, snapshots should be created on disk
- Tests must not query LLM - use abstraction to mock this reliably across all files

### Unit Testing - LLMs

Use docs/SNAPSHOT_TESTING.md

### Testing - test command

The whole point of the test command is to test spawn and not work around it.

Whenever making changes to agent definitions, use test command quickly verify

### Spot testing

`npm run dev -- <command> <args>`

### QA

QA is not a script e.g. typescript script. It's a plan in markdowon format that is executed by agent. If you spot any QA that is script, switch it over to markdown doc describing steps to execute.

### Visual testing - use screenshots to see

You must test changes via screenshots

`npm run screenshot-poe-code -- <command>`

e.g.

`npm run screenshot-poe-code -- --help`

Make sure they are designed well, functional and work correctly.
Test every change using screenshots that might have impact on visual cli
Don't write any screenshot tests, screenshots are only for adhoc validations

Do not use libraries like @clack/prompts or chalk directly, otherwise we won't achieve coherent style.

### E2E Tests

Use judgement when to run these `npm run e2e:verbose`

## Readme

Keep the readme up to date but you are not allowed to add anything to readme without user's permission.

## Planning

Planning docs MUST be in `docs/plans` folder, NO EXCEPTIONS even in planning. ABSOLUTELY NO OTHER PLANNING LOCATIONS!!!!!

WE ARE NOT USING CLAUDE PLANS

## CLI vs SDK

When implementing features e.g. new cli args, make sure to keep parity with SDK and expose the same args.

The CLI should be using SDK

## Interactive CLI

The goal is to have interactive CLI using the design_system
However, it is imperative that all configuration can be done also via cli args

Defaults are only accepted when --yes

Any action that theoretically takes longer than 700ms, shold use spinner, use your judgement, this is a soft guideline.

### Example <agent>

`$ poe-code configure`

- will prompt for agent and model, despite agent having a default

`$ poe-code configure --agent claude`

- will prompt only for model

`$ poe-code configure --agent claude --model Claude-Sonnet-4.5`

- will not prompt

### --yes option

Mainly for use in CI

`$ poe-code configure --yes`

- will accept the defaults

Automatically accept defaults

## Other recommendations

- When changing the visual language / design languge, make sure to run `npm run generate:design-docs`

## Figure it out

No failing test is a pre-existing issue, you need to make it work
Test timeouts must be fixed

## SKILLS

When editing poe-code skills, edit templates SKILL_

Then sync skills via `npm run sync-skills`


## Agent harnesses

When talking about agent harnesses, it's all of these

 - agent-harness - the SafeJS 
 - pipeline
 - gaslight
 - ralph
 - superintendent
 - ...
