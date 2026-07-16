---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- superintendent validate prints 'error: missing required argument path' twice (raw Commander + design-system); packages/toolcraft/src/cli.ts:6116 outputError only suppresses unknown command/option, so cli.ts:5738 logger.error re-renders it"
comment: "Duplicate in shape of ux-code-review-drafts-missing-arg-double-error.md; consolidate into one issue about the toolcraft double-error. Its contribution is the pattern claim - superintendent and code-review both double-render and both misidentify the binary - which localises the fix to the shared toolcraft Commander integration rather than either command. With ux-models-endpoint-bogus-double-error-and-stack.md and ux-runtime-templates-parent-no-default-subcommand.md that makes four double-render sightings; worth checking they share one cause."
---

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
