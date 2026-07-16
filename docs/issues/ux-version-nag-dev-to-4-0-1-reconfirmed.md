---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/services/version.ts:41 semver.gt(latest, currentVersion) with no 0.0.0-dev guard; src/cli/commands/version.ts:53 prints the nag whenever updateAvailable"
comment: "One of five filings of the dev-build version nag; consolidate into ux-version-nags-dev-to-major-jump.md. Worth noting the cluster disagrees on the target version (4.0.0 versus 4.0.1), which is expected drift over the audit window but confirms the files were written at different times rather than duplicated blindly."
---

# UX: version nag 0.0.0-dev → 4.0.1 still present (reconfirmed)

## Summary

poe-code -V still shows Update available: 0.0.0-dev -> 4.0.1 on monorepo/dev builds.

## Evidence

▲  Update available: 0.0.0-dev -> 4.0.1

## Why it matters

Reconfirm version nag on dev builds.

## Suggested direction

Skip nag when version contains -dev or local build.

## Severity

Medium

## Area

Version
