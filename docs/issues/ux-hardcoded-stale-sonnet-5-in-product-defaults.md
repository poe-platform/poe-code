---
severity: critical
impact: correctness
comment: "Third Critical filing of the sonnet-5 root cause, overlapping ux-constants-source-of-dead-sonnet-5.md (which pins the file and every consumer) and ux-frontier-models-only-sonnet-5-is-dead.md (which bounds the fix to one string). Its distinct contribution is the runtime blast radius - gaslight, pipeline and spawn all failing with 400 - which is the best argument for the severity. Consolidate the three into one root-cause issue carrying all three angles: location, minimal diff, and impact."
reproduced: y
recommendation: no-fix
evidence: "src/cli/constants.ts:3 FRONTIER_MODELS includes anthropic/claude-sonnet-5; :14 CLAUDE_CODE_VARIANTS.sonnet is the same id; :18 DEFAULT_CLAUDE_CODE_MODEL = that variant; :37 GOOSE_MODELS = FRONTIER_MODELS; src/providers/goose.ts:102 maps anthropic/claude-sonnet-5 to 983_040. Defaults confirmed present, but this duplicates canonical root cause ux-constants-source-of-dead-sonnet-5.md (recommendation=fix) and ux-frontier-models-only-sonnet-5-is-dead.md; no-fix here means close as duplicate, not that the defect is absent."
---

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
