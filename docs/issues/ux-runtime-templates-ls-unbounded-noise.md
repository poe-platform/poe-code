---
severity: low-medium
impact: usability
comment: "Contentless duplicate of ux-runtime-templates-ls-unbounded-stale.md; retire into it. Same unbounded-history class as runtime jobs ls - one bounded-output convention covers both."
reproduced: n
recommendation: no-fix
evidence: "packages/poe-code-config/src/state/templates.ts:11 declares TemplateBackend = docker only, and src/cli/commands/runtime/templates/ls.ts:11 iterates backends = [docker], so the claimed e2b /tmp rows cannot appear; unbounded output itself is real (ls.ts:21 action takes no --limit/--all) but is the kept sibling ux-runtime-templates-ls-unbounded-stale.md."
---

# UX: runtime templates ls noise

## Summary

Old e2b /tmp rows.

## Evidence

templates ls.

## Why it matters

Ops noise.

## Suggested direction

Prune guidance.

## Severity

Low–Medium

## Area

Runtime
