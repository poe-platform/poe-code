---
severity: high
impact: usability
comment: "Keep as canonical of the four-file maestro dry-run cluster: only this one catches both halves - bare 'maestro dry-run' is silently accepted as a workflow path (so a user who forgets the dashes gets 'Missing workflow file .../dry-run' rather than a hint), and --dry-run then hits GitHub 401 with raw JSON. The positional-versus-flag confusion is a genuinely distinct defect the other three miss. Three fixes: reject 'dry-run' as a path with a hint, validate locally first, and map 401 to a UserError pointing at auth."
---

# UX: maestro dry-run as path is accepted; --dry-run hits GitHub 401

## Summary

`maestro dry-run` treats dry-run as a WORKFLOW.md path (Missing workflow file …/dry-run). `maestro --dry-run` validates and then hits GitHub GraphQL 401 Bad credentials raw JSON — dry-run is not fully offline and error is raw.

## Evidence

```bash
$ poe-code maestro dry-run
■  Error: Missing workflow file at …/dry-run.
$ poe-code maestro --dry-run
■  Error: GitHub GraphQL request failed with status 401: { "message": "Bad credentials", … }
```

## Why it matters

Users confuse positional dry-run with flag; dry-run still needs GitHub auth and dumps raw API errors.

## Suggested direction

Reject bare dry-run as path with hint; dry-run offline validation; map 401 to UserError login gh.

## Severity

**High**

## Area

Maestro
