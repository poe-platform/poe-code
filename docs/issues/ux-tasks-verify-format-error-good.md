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
