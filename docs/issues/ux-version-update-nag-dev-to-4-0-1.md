---
severity: medium
impact: polish
comment: "Duplicate within the version-nag cluster (same 4.0.1 target as its sibling reconfirm); retire into ux-version-nags-dev-to-major-jump.md."
reproduced: y
recommendation: no-fix
evidence: "src/services/version.ts:43 semver.gt(latestVersion, currentVersion) has no -dev guard; src/cli/commands/version.ts:50-55 emits 'Update available' + npm install -g; node semver.gt('4.0.1','0.0.0-dev') === true. Duplicate of ux-version-nags-dev-to-major-jump.md"
---

# UX: version nag compares 0.0.0-dev to 4.0.1

## Summary

poe-code -V shows Update available: 0.0.0-dev -> 4.0.1 — noisy on monorepo/dev builds.

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
