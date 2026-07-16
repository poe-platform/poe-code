---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- pipeline run --help lists only agent/model/tui/archive/task/plan/plans/max-runs/worktree; global -y, --yes defined at src/cli/program.ts:852 and consumed at src/cli/commands/pipeline.ts:1019 (assumeYes) yet unlisted; no --mode option registered in registerPipelineCommand (src/cli/commands/pipeline.ts:879-896)"
comment: "Instance of the global-flags-not-listed family; retire into ux-global-flags-hidden-on-subcommand-help.md. Its --mode half deserves a separate check though: if pipeline run genuinely has no --mode, that is a capability gap in the permission-mode matrix (ux-permission-mode-sets-differ-across-commands.md) rather than a help omission - the file assumes the flag exists."
---

# UX: pipeline run --help omits --yes and --mode

## Summary

pipeline run help has agent/model/tui/archive/task/plan/max-runs/worktree — no --yes, --mode, dry-run notes for non-TTY CI.

## Evidence

pipeline run Options: no --yes, no --mode

## Why it matters

CI pipeline runs need documented non-TTY flags.

## Suggested direction

Document --yes; mode if applicable; non-TTY contract.

## Severity

**High**

## Area

Pipeline
