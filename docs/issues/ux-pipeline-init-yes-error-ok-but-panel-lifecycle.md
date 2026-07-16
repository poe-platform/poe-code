---
severity: medium
impact: usability
comment: "Contentless, but it points at the panel-lifecycle bug that ux-error-panel-closes-before-error.md owns: the Problems footer renders before the error. Retire into that; the pipeline-specific half (the validation message) is already covered as a positive in ux-pipeline-init-yes-requires-source-good.md."
reproduced: y
recommendation: no-fix
evidence: "Live probe 'npm run dev -- pipeline init --yes --dry-run' prints the outro '|_ Problems? https://github.com/poe-platform/poe-code/issues' before the error '# Provide --source or --sources when using --yes.'; src/cli/commands/pipeline.ts:1182 throws ValidationError while the finally at src/cli/commands/pipeline.ts:1261-1262 calls context.finalize(), which emits feedback('Problems?') at src/cli/context.ts:69 (outro at src/cli/logger.ts:249) before bootstrap's catch prints the error. Duplicate: lifecycle owned by ux-error-panel-closes-before-error.md, message covered by ux-pipeline-init-yes-requires-source-good.md."
---

# UX: pipeline init panel lifecycle

## Summary

Good validation Problems first.

## Evidence

pipeline init --yes.

## Why it matters

Lifecycle cluster.

## Suggested direction

Fix finalize.

## Severity

Medium

## Area

Pipeline
