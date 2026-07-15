---
severity: medium
impact: discoverability
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
