# UX: gh install --dry-run lists paths without design-system panel

## Summary

github-workflows install --dry-run prints bare workflow paths and would write messages without panel framing; unclear if dry-run or real.

## Evidence

```text
/Users/…/.github/workflows/poe-code-fix-vulnerabilities.yml
…
Shared variables would be written to …
Command reference would be written to …
```

## Why it matters

Dry-run should be explicitly labeled and framed.

## Suggested direction

Design-system dry-run list with Dry run: prefix.

## Severity

Medium

## Area

GitHub workflows
