---
severity: low
impact: none
comment: "Thin positive - 'Installed OpenCode CLI' is unremarkable and is the same message the install cluster criticises for being indistinguishable from a no-op (ux-install-always-success-reconfirmed.md). Its real value is the caveat it records: install succeeds while test remains broken for the same agent (ux-test-opencode-model-mapping-still-broken.md), so a successful install does not imply a working agent. Fold that caveat into the test issue and retire this."
---

# UX: install opencode --yes success is clear (positive)

## Summary

install opencode --yes: Installed OpenCode CLI — clear success (test still broken after install).

## Evidence

◆  Installed OpenCode CLI.

## Why it matters

Positive install success; test path still needs model mapping fix.

## Suggested direction

Keep install message; fix test mapping.

## Severity

Low

## Area

Install / positive pattern
