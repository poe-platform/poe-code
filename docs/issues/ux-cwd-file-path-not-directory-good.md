---
severity: low
impact: none
comment: "Positive pattern, near-duplicate of ux-cwd-missing-path-good-message.md (same validation - one non-directory, one missing path); consolidate the pair. Both concede the same residual 'See logs' tease, so the only real ask belongs to ux-user-errors-look-like-system-failures.md rather than here."
---

# UX: --cwd file path error is good (positive)

## Summary

spawn --cwd package.json returns Workspace path … is not a directory clearly.

## Evidence

```bash
$ poe-code spawn pi "ok" --mode read --cwd …/package.json
■  Error: Workspace path "…/package.json" is not a directory.
```

## Why it matters

Positive path validation (still See logs).

## Suggested direction

Keep; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern
