---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/worktree.ts:40-45 declares only --delete-branch while -y, --yes is root-only at src/cli/program.ts:852; probe 'npm run dev -- worktree remove --help' lists just --delete-branch, and 'worktree remove ghost-name-triage-probe --yes' accepts the flag then prints 'Error: Worktree not found in registry' plus 'See logs at ...errors.log' because packages/worktree/src/remove.ts:18 throws plain Error, not ValidationError."
comment: "Keep of this pair (covers both the help omission and the not-found chrome, with evidence that --yes is accepted despite being undocumented - the classic help/behavior mismatch of the global-flags family). Its two halves route to ux-global-flags-hidden-on-subcommand-help.md and ux-user-errors-look-like-system-failures.md respectively."
---

# UX: worktree remove --help omits --yes but accepts it; missing not-found has See logs

## Summary

worktree remove --help shows only --delete-branch; no --yes. worktree remove ghost-name --yes fails Worktree not found with See logs system chrome.

## Evidence

```bash
$ poe-code worktree remove --help
# Options: --delete-branch only
$ poe-code worktree remove ghost-name --yes
■  Error: Worktree "ghost-name" not found in registry
●  See logs at …/errors.log
```

## Why it matters

Help incomplete; not-found should be ValidationError without logs.

## Suggested direction

Document --yes; UserError without See logs.

## Severity

Medium

## Area

Worktree
