---
severity: medium
impact: polish
comment: "Reconfirm duplicate within the version-nag cluster; retire into ux-version-nags-dev-to-major-jump.md. No new evidence."
reproduced: y
recommendation: no-fix
evidence: "src/services/version.ts:43 semver.gt with no dev guard; src/cli/commands/version.ts:50-55 warns 'Update available' + npm install -g; node semver.gt('4.0.0','0.0.0-dev') === true. Duplicate of ux-version-nags-dev-to-major-jump.md"
---

# UX: version still nags 0.0.0-dev → 4.0.0 (reconfirmed)

## Summary

Reconfirmed: --version shows Update available: 0.0.0-dev -> 4.0.0 and npm install -g suggestion.

## Evidence

version panel: 0.0.0-dev local build; Update available → 4.0.0.

## Why it matters

Reconfirm skip update check for dev builds.

## Suggested direction

Skip nag when version is 0.0.0-dev or local build.

## Severity

Medium

## Area

Version
