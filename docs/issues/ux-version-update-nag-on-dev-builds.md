---
severity: low-medium
impact: polish
comment: "Contentless fifth filing of the version nag; retire. Its 'contributor noise' framing is the accurate severity assessment for the whole cluster and worth carrying into the canonical - five files at Medium for something no end user ever sees is exactly the over-rating this triage should correct."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/version.ts:47 calls checkForUpdate for 0.0.0-dev with no dev-build skip; src/services/version.ts:43 semver.gt(latest, '0.0.0-dev') is always true, so nag always fires. Duplicate of ux-version-nags-dev-to-major-jump.md, ux-version-still-nags-dev-to-4.0.0.md, ux-version-update-nag-dev-to-4-0-1.md, ux-version-nag-dev-to-4-0-1-reconfirmed.md"
---

# UX: version nags 0.0.0-dev

## Summary

Always update available.

## Evidence

--version.

## Why it matters

Contributor noise.

## Suggested direction

Skip dev builds.

## Severity

Low–Medium

## Area

Version
