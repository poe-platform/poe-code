---
severity: high
impact: crash
comment: "The most serious eval filing and the only one about broken behavior rather than presentation: the scaffold produced by eval init cannot survive its own suggested next command, and it fails with a git remote-helper error that says nothing about the real cause (a placeholder target URL). Two fixes, both needed: scaffold a runnable target, and validate the target with a UserError instead of letting git fail raw. Prioritise over the eval help/framing cluster - this breaks the documented first-run path."
---

# UX: eval check fails with opaque git remote-helper error on scaffolded eval

## Summary

eval init then eval check clones a placeholder target and fails: git: remote-helper git+https aborted — scaffold creates non-runnable eval that errors opaquely on first check.

## Evidence

```bash
$ poe-code eval init good-eval-name --kind plan
$ poe-code eval check good-eval-name
Cloning into …/runs/.check/…/clone...
git: 'remote-git+https' is not a git command…
fatal: remote helper 'git+https' aborted session
```

## Why it matters

First-run eval path is broken by default scaffold target.

## Suggested direction

Scaffold with local/no-op target; validate target URL; clear UserError for bad target.

## Severity

**High**

## Area

Eval
