---
severity: high
impact: usability
comment: "Fifth filing of the maestro dry-run network dependency, this time on the run subcommand; retire into ux-maestro-dry-run-path-vs-flag-confusion.md. Its coverage detail matters: the behavior is identical on maestro and maestro run, so the fix belongs in the shared dry-run path. Its '--online for candidate inspect' idea is the cleanest suggestion in the cluster - keep dry-run offline by default and make the network call opt-in."
---

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
