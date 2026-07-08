# UX: code-review drafts missing prUrl double-errors

## Summary

Missing prUrl shows raw error: missing required argument then design-system error with same text and npm run dev help — double skin + wrong binary.

## Evidence

```bash
$ poe-code code-review drafts
error: missing required argument 'prUrl'
■  error: missing required argument 'prUrl'
│  Run npm run dev -- code-review drafts --help
```

## Why it matters

Reconfirm double-error + npm run dev identity on code-review.

## Suggested direction

Single ValidationError; displayBinaryName.

## Severity

**High**

## Area

Code-review / errors
