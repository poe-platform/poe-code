---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-runtime-missing-deps-good-message-system-chrome.md, which covers the same messages from the defect side. Consolidate. The install hints (Docker Desktop, Colima, Podman) are the best recovery copy in the product and worth citing as the template; the See logs residue is the systemic issue."
reproduced: y
recommendation: no-fix
evidence: "packages/process-runner/src/docker/engine.ts:13-18 throws plain Error with Docker Desktop/Colima/Podman hints; src/cli/bootstrap.ts:70-81 appends 'See logs at ...' because it is not a CliError with isUserError"
---

# UX: spawn --runtime docker missing engine has good install hints (positive)

## Summary

No container engine found includes Docker Desktop / Colima / Podman install hints — good recovery copy (still See logs).

## Evidence

```bash
$ poe-code spawn … --runtime docker
■  Error: No container engine found. Please install Docker or Podman:
│  - Docker Desktop: …
│  - Colima …
│  - Podman …
```

## Why it matters

Positive recovery pattern.

## Suggested direction

Keep; drop See logs for this user error.

## Severity

Low

## Area

Spawn / positive pattern
