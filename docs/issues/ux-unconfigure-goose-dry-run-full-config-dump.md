---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/providers/goose.ts:295 unconfigure runs configMutation.prune on ~/.config/goose/config.yaml; src/providers/create-provider.ts:123 runMutations omits dryRun, so apply-mutation.ts:830 configPrune calls writeAtomically (apply-mutation.ts:107) writing a random .mutation-tmp- path; src/utils/dry-run.ts:88 finds no previous content for that temp path, so renderWriteOperation marks it create and renderUnifiedDiff (dry-run.ts:300) emits the whole 99-line config.yaml (wc -l ~/.config/goose/config.yaml = 98, extensions block) as + lines"
comment: "Duplicate within the dry-run flood family; retire into ux-configure-dry-run-dumps-entire-existing-agent-config.md. Its 'summarize preserved extensions' suggestion matches the canonical's 'N project entries preserved' shape - one fix, one wording."
---

# UX: unconfigure goose --dry-run dumps full config rewrite

## Summary

unconfigure goose --dry-run creates large full config.yaml + dump rather than intentional-only removal summary — dry-run flood class.

## Evidence

unconfigure goose --dry-run → full +config.yaml with many extensions.

## Why it matters

Reconfirm dry-run dump noise.

## Suggested direction

Intentional-only diff; summarize preserved extensions.

## Severity

Medium

## Area

Dry-run
