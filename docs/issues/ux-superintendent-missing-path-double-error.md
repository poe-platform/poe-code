# UX: superintendent validate/complete missing path double-errors with npm run dev

## Summary

superintendent validate and complete without path print raw Commander missing required argument then design-system repeat with npm run dev help — same pattern as code-review drafts.

## Evidence

```bash
$ poe-code superintendent validate
error: missing required argument 'path'
■  error: missing required argument 'path'
│  Run npm run dev -- superintendent validate --help
```

## Why it matters

Toolcraft commands consistently double-error and misidentify binary.

## Suggested direction

Single ValidationError; displayBinaryName=poe-code.

## Severity

**High**

## Area

Superintendent / errors
