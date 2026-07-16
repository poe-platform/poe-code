---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- ralph run --help lists agent/iterations/cwd/archive/tui/worktree/runtime/detach but no --yes; --yes is a global program option at src/cli/program.ts:852 and ralph run reads it via resolveCommandFlags(program) in src/cli/commands/ralph.ts. Duplicate of ux-global-flags-hidden-on-subcommand-help.md."
comment: "Instance of the global-flags-not-listed family; retire into ux-global-flags-hidden-on-subcommand-help.md. Its option list is incidentally useful evidence for ux-gaslight-no-activity-timeout-flag.md: ralph run has runtime, detach and worktree but no activity timeout, confirming the runner flag surfaces diverge."
---

# UX: ralph run --help omits --yes

## Summary

ralph run help has agent/iterations/cwd/archive/tui/worktree/runtime/detach — no --yes for non-TTY.

## Evidence

ralph run Options: no --yes

## Why it matters

Non-TTY ralph CI needs --yes.

## Suggested direction

Document --yes.

## Severity

Medium

## Area

Ralph
