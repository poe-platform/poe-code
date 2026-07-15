---
severity: high
impact: usability
comment: "Symptom-side duplicate of ux-approval-copy-hardcodes-toolcraft-in-source.md; one fix - inject the host binary name into approval copy - closes both. Same product-identity family as the widespread 'npm run dev' usage-line issues; worth one sweep over user-facing copy for host-name correctness rather than piecemeal edits."
---

# UX: Queued approval messages say toolcraft approvals

## Summary

Blocked-flow copy Track toolcraft approvals show id.

## Evidence

toolcraft/src/cli.ts hardcodes toolcraft approvals.

## Why it matters

Wrong product name for recovery.

## Suggested direction

Inject host binary name.

## Severity

**High**

## Area

Approvals / recovery
