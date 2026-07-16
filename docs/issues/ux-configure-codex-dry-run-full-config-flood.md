---
severity: medium
impact: usability
comment: "One of four filings of the codex dry-run flood; all describe one defect - the dry-run renders a whole-file rewrite instead of the intentional change set. Consolidate into ux-configure-dry-run-dumps-entire-existing-agent-config.md, which is the strongest of the set."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- configure codex --model openai/gpt-5.3-codex --yes --dry-run emits 250 lines; writeAtomically targets config.toml.mutation-tmp-* so previousContent is null and src/utils/dry-run.ts:296 renderWriteOperation prints full-file '@@ -0,0 +1,31 @@' create diffs including unrelated [projects.*] and [notice.model_migrations]. Duplicate of ux-configure-dry-run-dumps-entire-existing-agent-config.md"
---

# UX: configure codex --dry-run floods full multi-profile config

## Summary

configure codex --model openai/gpt-5.3-codex --yes --dry-run dumps large multi-profile config with migrations and unrelated project paths — dry-run flood class.

## Evidence

dry-run includes many project profiles, model_migrations, kindle-alpha, gpt migrations…

## Why it matters

Users cannot see intentional changes for this configure call.

## Suggested direction

Intentional-only diff of active profile + model.

## Severity

Medium

## Area

Dry-run
