---
severity: high
impact: discoverability
comment: "Keep as canonical of this pair (fuller fix list). Legitimate and part of the strongest cluster in the audit: logout's help describes a factory reset in seven words with no blast radius, no file list and no confirmation policy, while ux-auth-logout-no-confirmation-removes-all-agents.md proves it removes every agent config with no gate. Its 'split credentials vs reset' suggestion is the real answer and matches ux-logout-overclaims-scope.md - the copy cannot be fixed without deciding what the command should do."
---

# UX: logout --help does not warn of full factory-reset scope

## Summary

logout help only says Remove all configuration and credentials with no file list, agent impact, or confirmation policy.

## Evidence

```text
Usage: poe-code logout [options]
Remove all configuration and credentials.
```

## Why it matters

Destructive command help must state blast radius.

## Suggested direction

List actions; require --yes in non-TTY; confirm on TTY; split credentials vs reset.

## Severity

**High**

## Area

Auth / destructive
