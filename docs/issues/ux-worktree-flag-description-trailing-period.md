---
severity: low
impact: polish
comment: "The smallest finding in the audit and correctly rated 'Low (systemic)': one flag description ends with a period where no other does, across four commands. Its own diagnosis is the interesting part - the shared description was written outside the flag convention - which makes it a one-line fix in one place. Worth doing only inside a broader copy pass; alone it is not worth a commit. Note this file is absent from MASTER.md."
---

# UX: --worktree flag description ends with period across all run commands

## Summary

The `--worktree` flag description reads "Run in a managed git worktree and reconcile successful output." — with a trailing period. No other flag description in the CLI ends with a period. This affects every command that accepts `--worktree`:

- `poe-code gaslight [plan-path]`
- `poe-code ralph run [doc]`
- `poe-code experiment run [doc]`
- `poe-code pipeline run`

## Evidence

```
--worktree   Run in a managed git worktree and reconcile successful output.
                                                                          ^
```

Every other flag description in these same Options sections is punctuation-free.

## Why it matters

Minor but systemic. The inconsistency is visible to anyone reading the help closely and suggests the description was written separately from the shared flag convention.

## Suggested direction

Remove the trailing period: "Run in a managed git worktree and reconcile successful output"

## Severity

Low (systemic)

## Area

Gaslight / ralph / experiment / pipeline / help / flag description consistency
