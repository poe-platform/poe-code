---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/github-workflows/src/commands.ts:277 `eject: S.Optional(S.Boolean())` has no description; `npm run dev -- gh install --help` prints bare '--eject' with no explanatory text"
comment: "Contentless ('Description eject.', 'Explain.'), but the concern is legitimate given blast radius - ejecting is usually irreversible and the help says only 'eject'. Fold into the gh install help work with ux-gh-install-preview-without-dry-run-flag.md; the concrete ask is one sentence on what ejecting produces and whether it can be undone."
---

# UX: gh install --eject opaque

## Summary

Description eject.

## Evidence

gh install --help.

## Why it matters

High-impact.

## Suggested direction

Explain.

## Severity

Low–Medium

## Area

GH workflows
