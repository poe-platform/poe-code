# UX: maestro run --dry-run still hits GitHub 401 (reconfirmed)

## Summary

maestro run --dry-run --yes still performs GitHub GraphQL and dumps 401 Bad credentials JSON — dry-run is not offline (reaffirm maestro dry-run issues).

## Evidence

```bash
$ poe-code maestro run --dry-run --yes
■  Error: GitHub GraphQL request failed with status 401: { "message": "Bad credentials", … }
```

## Why it matters

Dry-run must not require live GitHub auth for config validation.

## Suggested direction

Offline validate WORKFLOW.md; optional --online for candidate inspect.

## Severity

**High**

## Area

Maestro
