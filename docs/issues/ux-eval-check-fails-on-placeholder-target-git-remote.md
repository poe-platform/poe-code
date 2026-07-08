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
