---
severity: medium
impact: polish
comment: "Duplicate within the version-nag cluster (same 4.0.1 target as its sibling reconfirm); retire into ux-version-nags-dev-to-major-jump.md."
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
