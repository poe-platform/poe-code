---
severity: medium
impact: usability
comment: "Contentless twin of ux-gaslight-config-missing-enoent-system-chrome.md; retire into it. Its one word of value is 'validate early' - checking the config path before doing anything else is the right shape."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-gaslight/src/config.ts:108-119 explicit configPath branch calls fs.readFile with no ENOENT guard, so raw ENOENT escapes as non-ValidationError; duplicate of ux-gaslight-config-missing-enoent-system-chrome.md"
---

# UX: gaslight --config ENOENT

## Summary

Raw ENOENT.

## Evidence

--config /missing.

## Why it matters

Validate early.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Gaslight
