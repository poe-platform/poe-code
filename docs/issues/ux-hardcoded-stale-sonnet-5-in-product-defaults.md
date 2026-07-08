# UX: Product defaults still hard-code anthropic/claude-sonnet-5 which API rejects

## Summary

CLI constants and goose provider model lists still include anthropic/claude-sonnet-5 as a default/catalog entry, while live API returns 400 Unsupported model for that id. This is the root cause feeding configure defaults, skip-if-configured display, and runtime failures.

## Evidence

src/cli/constants.ts lists anthropic/claude-sonnet-5 and sonnet alias.
src/providers/goose.ts models map includes anthropic/claude-sonnet-5.
Live: gaslight/pipeline/spawn fail with Unsupported model: claude-sonnet-5.
configure --yes dry-run plans to write that model.

## Why it matters

Defaults that reference dead model ids systematically poison configure and run paths.

## Suggested direction

Refresh defaults from live catalog or known-good allow-list; remove sonnet-5; alias sonnet to current sonnet; validate on configure.

## Severity

**Critical**

## Area

Config / models
