---
severity: medium
impact: usability
comment: "Reconfirm duplicate in the codex dry-run flood cluster; contributes only a second sighting and no new evidence. Retire into ux-configure-dry-run-dumps-entire-existing-agent-config.md."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- configure codex --yes --dry-run emits full-file + blocks: [projects.\"/Users/kjopek/Workspace/ai-app\"], [notice.model_migrations], [profiles.\"gpt-5.5\"]; cause is parse+re-stringify in packages/config-mutations/src/formats/toml.ts:21 diffed at src/utils/dry-run.ts:318; duplicate of ux-configure-dry-run-dumps-entire-existing-agent-config.md"
---

# UX: configure codex --dry-run still floods multi-profile config (reconfirm)

## Summary

configure codex --model openai/gpt-5.3-codex --yes --dry-run still dumps many profile/migration lines (gpt migrations, iris-alpha, multiple projects) — dry-run flood class reconfirm.

## Evidence

dry-run includes many +model_migrations, project paths, gpt-5.5 profiles…

## Why it matters

Reconfirm intentional-only dry-run needed for codex.

## Suggested direction

Show only intentional model/provider changes for this call.

## Severity

Medium

## Area

Dry-run
