---
severity: medium
impact: discoverability
comment: "Small and real, and part of a coherent trio with ux-help-command-not-registered.md and ux-whoami-root-missing-auth-only.md: 'version', 'help' and 'whoami' are all near-universal CLI verbs returning Unknown command while the capability exists behind a flag or a group. Fix all three as one aliasing change - each is a first-touch habit and the cost of failing them is disproportionate to the fix."
---

# UX: `version` subcommand missing; only -V/--version work

## Summary

poe-code version is Unknown command; version works via -V/--version. Users typing version as subcommand (common pattern) fail.

## Evidence

```bash
$ poe-code version
■  Unknown command: version
$ poe-code --version
# works (version panel)
```

## Why it matters

Common CLI pattern expects version subcommand or alias.

## Suggested direction

Add version command aliasing --version; or Did you mean: --version.

## Severity

Medium

## Area

Version
