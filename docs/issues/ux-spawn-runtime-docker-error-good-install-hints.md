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
