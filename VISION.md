# Poe Code Vision

Poe Code lets developers use their preferred coding agents through Poe.
One Poe subscription should be enough to run Claude Code, Codex, OpenCode,
Kimi, Goose, and future agents without juggling provider accounts, API keys,
or one-off configuration systems.

The product should feel like a thin, reliable layer over tools people already
use. A user can configure an agent once and keep using its normal CLI or desktop
app, spawn agents from scripts, or expose Poe models through MCP.

Project overview and user docs: [`README.md`](README.md)
Active direction: [`ROADMAP.md`](ROADMAP.md)
Agent contribution guide: [`docs/ADDING_AGENT.md`](docs/ADDING_AGENT.md)

## Current Focus

Priority:

- Setup reliability and first-run UX
- Stable provider-driven configuration
- Spawn quality for interactive and non-interactive agent runs
- CLI and SDK parity
- Clear MCP and skills support
- Fast, useful tests that exercise real behavior
- Consistent terminal UI through the design system

Next priorities:

- Make adding an agent mostly declarative
- Reduce provider boilerplate and manual registration
- Keep core lightweight while moving real logic into focused packages
- Improve GitHub repository workflows for spawn and code review
- Expand model, media, and MCP capability discovery through Poe
- Improve release confidence without slowing local development

## Product Principles

Poe Code is not trying to replace coding agents.
It should make them easier to run, configure, test, and compose through Poe.

Users should be able to:

- Use existing agent CLIs with minimal behavior changes
- Configure and unconfigure integrations explicitly
- Run one-off prompts from the CLI or SDK
- Use the same options from CLI and SDK entry points
- Inspect mutations with dry-run output before changing files
- Use Poe models through MCP when an agent supports MCP

## Architecture Principles

Core should stay lightweight.
It wires packages together, exposes public APIs, and owns the top-level CLI
surface. Real logic belongs in specific packages with their own README,
configuration contract, and tests.

Providers should be declarative and minimal.
Adding a new provider should move toward a single provider file, with behavior
derived from agent definitions, provider config, and shared package machinery.
Provider-specific branching in shared code is a design smell.

Provider files should not know about logging, dry-run behavior, or unrelated
CLI mechanics. If an agent needs imperative execution, it may define a focused
`spawn(context, options)` hook. Prefer shared declarative spawn configuration
when it can express the run.

The CLI should use the SDK.
When a new CLI option changes behavior, the SDK should expose the same
capability unless there is a clear reason not to.

## Configuration

Configuration changes must be structured, reversible, and explicit.
When editing existing config files, parse the file format and deep merge the
change. Do not use regexes to modify config. If a supported integration uses a
new format, add a parser rather than relying on string replacement.

Dry-run output should show what will change without mutating disk.
Unconfigure should remove the Poe Code-owned integration without damaging
unrelated user settings.

Configuration should not preserve compatibility by accumulating hidden
provider-specific special cases. If a shape changes, the migration path should
be explicit and tested.

## Security

Poe Code handles credentials and configuration for developer tools, so risky
actions should be visible and operator-controlled.

We prioritize:

- Local credential storage with clear login, status, and logout flows
- Explicit file mutations
- Safe path handling for workspace and GitHub repository operations
- Clear failures when an agent cannot support a requested capability
- No hidden network or provider behavior outside the user's command

Long-running and multi-agent workflows are allowed, but the user should know
when they are configuring credentials, changing agent config, invoking MCP
servers, or running an agent in a workspace.

## Contribution Rules

Code changes should be test-driven.
Write the failing test first, implement the smallest useful change, then keep
the tests fast enough to be part of normal development.

Documentation-only and config-only changes do not need unit tests, but they
should still be validated with the relevant formatter, linter, or workflow
check.

Plans belong in `docs/plans`.
Do not create planning docs anywhere else.

Package changes should keep package docs current.
If a package exposes environment variables or config options, its README should
document them.

Do not update the root README without explicit user permission.

## What We Will Not Merge For Now

- Provider-specific `if` or `case` branches in shared provider machinery
- Config mutations implemented with regex replacement
- Functions that only proxy to another function without adding behavior
- Core features that belong in a focused package
- New provider boilerplate that repeats information already present in config
- Slow unit tests that depend on real LLM calls or avoidable external work
- Tests that create files on disk when `memfs` can cover the behavior
- Unit tests for GitHub workflows
- QA implemented as scripts instead of markdown execution plans
- Direct terminal styling that bypasses the shared design system
- CLI-only behavior that should also be available through the SDK

This list is a direction guardrail.
Strong user demand and a clear technical reason can change it, but the default
is to keep Poe Code small, provider-driven, explicit, and fast to test.

## Release Direction

Releases happen on GitHub, not locally.

Pushing to `main` publishes the stable `poe-code@latest` release.
Pushing to `beta` publishes `poe-code@beta`.

After a push, the release workflow is the source of truth.
The work is not complete until the relevant GitHub release run succeeds or the
failure is understood and reported.
