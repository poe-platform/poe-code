---
severity: low
impact: none
comment: "Keep of this positive pair - it notices the '[error]' prefix the twin misses. That prefix is a small but real inconsistency: it appears across the tasks group (also in the GitHub 401 filings) and nowhere else, suggesting the group renders errors through its own path rather than the design system. Worth folding into ux-dual-help-systems.md as another instance of two output languages."
---

# UX: tasks verify format error is good (positive)

## Summary

Expected project to use owner/number format is clear (still [error] prefix odd).

## Evidence

```bash
$ poe-code tasks verify foo
■  [error] Expected project to use "<owner>/<number>" format.
```

## Why it matters

Positive message; drop [error] prefix noise.

## Suggested direction

ValidationError without [error] tag.

## Severity

Low

## Area

Tasks / positive pattern
