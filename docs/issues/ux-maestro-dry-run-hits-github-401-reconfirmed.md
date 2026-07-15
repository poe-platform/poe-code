---
severity: high
impact: usability
comment: "Reconfirm duplicate within the maestro dry-run cluster with no new evidence; retire into ux-maestro-dry-run-path-vs-flag-confusion.md."
---

# UX: maestro --dry-run hits GitHub 401 without workflow (reconfirmed)

## Summary

maestro --dry-run without valid WORKFLOW/auth: GitHub GraphQL 401 raw JSON — dry-run still network-calls GitHub; not local-only validate.

## Evidence

```bash
$ poe-code maestro --dry-run
■  Error: GitHub GraphQL request failed with status 401: { Bad credentials }
```

## Why it matters

Dry-run should validate config locally first; auth errors need gh auth login.

## Suggested direction

Local dry-run path; UserError for GitHub auth.

## Severity

**High**

## Area

Maestro
