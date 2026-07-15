---
severity: low
impact: none
comment: "Positive pattern; twin of ux-cwd-file-path-not-directory-good.md - keep one covering both cases. Worth citing as the precedent in ux-spawn-cwd-missing-see-logs.md and ux-spawn-cwd-file-not-directory-see-logs.md, which file these same commands as defects purely for the 'See logs' chrome: the message is right, only the chrome is wrong."
---

# UX: --cwd missing path error is good (positive)

## Summary

spawn --cwd /no/such/dir returns Workspace path does not exist clearly (still See logs).

## Evidence

```bash
$ poe-code spawn pi "ok" --mode read --cwd /no/such/dir
■  Error: Workspace path "/no/such/dir" does not exist.
```

## Why it matters

Positive not-found message.

## Suggested direction

Keep; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern
