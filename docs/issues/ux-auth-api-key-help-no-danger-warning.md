---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/auth.ts:26 description is 'Display stored API key.' with no warning or mask/--reveal option; src/cli/commands/auth.ts:116 writes the raw key to stdout. Duplicate of docs/issues/ux-auth-api-key-help-no-danger-or-mask-flag.md."
comment: "Duplicate within the help-warning sub-cluster; retire into a single consolidated help issue. Its one distinct argument - that users discover the leak only by running the command - is the strongest point in the sub-cluster and should survive the merge."
---

# UX: auth api-key --help does not warn that output is a secret

## Summary

Help says only Display stored API key with no mention of masking, --reveal, or secret handling — even though the command prints the full key.

## Evidence

```text
Usage: poe-code auth api-key [options]
Display stored API key.
Options: -h, --help
```

## Why it matters

Help should mark dangerous commands; users discover the leak only by running it.

## Suggested direction

Warn in description; document default mask + --reveal when implemented.

## Severity

**High**

## Area

Auth / security
