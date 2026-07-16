---
severity: medium
impact: correctness
comment: "Contentless twin of ux-agent-empty-api-key-silently-uses-stored.md; retire into it. Part of the empty-flag family whose best filing is ux-empty-api-key-login-good-but-configure-ignores.md, which proves the inconsistency rather than merely asserting the bug."
reproduced: y
recommendation: no-fix
evidence: "openai-auth.ts:4 toNonEmptyString('') -> undefined, so resolveOpenaiApiKey falls through to POE_API_KEY then store.get() at openai-auth.ts:22; src/cli/commands/agent.ts:48 forwards options.apiKey unvalidated. Behaviour real but duplicate of ux-agent-empty-api-key-silently-uses-stored.md (reproduced: y, recommendation: fix)"
---

# UX: Empty --api-key silently ignored

## Summary

--api-key '' falls back to stored key.

## Evidence

agent --api-key ''.

## Why it matters

Explicit flag discarded.

## Suggested direction

Require non-empty if present.

## Severity

Medium

## Area

Auth
