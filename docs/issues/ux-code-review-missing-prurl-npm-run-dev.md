---
severity: medium
impact: usability
comment: "Duplicate within the code-review missing-prUrl cluster; retire into ux-code-review-drafts-missing-arg-double-error.md. Its one added detail is coverage - the same break occurs on run and commit, not just drafts - which supports fixing at the Commander/toolcraft integration layer rather than per subcommand."
---

# UX: code-review run/commit missing prUrl uses npm run dev recovery

## Summary

code-review run without prUrl: missing required argument prUrl; Run npm run dev -- code-review run --help — raw + wrong binary name.

## Evidence

missing required argument 'prUrl' + npm run dev recovery.

## Why it matters

Reconfirm displayBinaryName on code-review toolcraft commands.

## Suggested direction

displayBinaryName=poe-code; design-system ValidationError.

## Severity

Medium

## Area

Code-review / identity
