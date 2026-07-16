---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/configure.ts:81 and src/cli/commands/provider.ts:57 register --shape-base-url with help 'Base URL for one provider API shape'; 'npm run dev -- configure --help' prints that line with no example and no list of valid shape ids."
comment: "Contentless ('Jargon no examples.'), though the underlying point is fair - shape-base-url is unexplained jargon to anyone who has not read the provider code. Fold into the configure help/examples work (ux-configure-help-missing-examples.md) rather than tracking separately. The concrete ask is one worked example plus a note that valid shapes are already listed on error, per ux-configure-unknown-api-shape-lists-exposed.md."
---

# UX: shape-base-url help opaque

## Summary

Jargon no examples.

## Evidence

configure help.

## Why it matters

Power users.

## Suggested direction

Examples glossary.

## Severity

Low–Medium

## Area

Configure help
