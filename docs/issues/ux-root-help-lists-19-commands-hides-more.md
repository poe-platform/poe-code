---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:81-100 ROOT_HELP_COMMAND_SPECS allow-lists exactly 19 commands; skill/memory/provider/runtime/launch/worktree/utils/braintrust/tasks/maestro registered (src/cli/commands/skill.ts:71, memory.ts:172, provider.ts:40, runtime/index.ts:10, launch.ts:42, worktree.ts:20, utils.ts:8, braintrust.ts:13, tasks.ts:56, program.ts:496) plus eval/gh/code-review/superintendent/approvals (program.ts:900-956) are absent from 'npm run dev -- --help' output."
comment: "Duplicate within the root help discoverability cluster; retire into ux-root-help-hides-skill-memory-runtime-eval-and-more.md. Its list is longer (it adds braintrust and gh) but it hedges with 'some may be elsewhere', so the canonical's verified per-command evidence is stronger. Carry the extra command names across."
---

# UX: root help lists ~19 commands but many more exist (skill, memory, …)

## Summary

Root help shows ~19 top-level commands; skill, memory, provider, runtime, launch, worktree, utils, braintrust, tasks, maestro, eval, code-review, gh, approvals, superintendent hidden from main list (some may be elsewhere).

## Evidence

root help command count ~19; skill/memory/provider/… not listed.

## Why it matters

Major surfaces undiscoverable from root help.

## Suggested direction

Expand root help or group Advanced: section with skill, memory, etc.

## Severity

**High**

## Area

Help / discoverability
