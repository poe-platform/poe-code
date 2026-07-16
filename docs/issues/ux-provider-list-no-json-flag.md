---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/provider.ts:44-48 registers list with no options; `npm run dev -- provider list --json` prints: error: unknown option '--json'"
comment: "Member of the --json inconsistency family; retire into ux-json-flag-inconsistent-across-commands.md. Its case is strengthened by the table problems though: since the Agents and API shapes columns truncate (ux-provider-list-table-layout-broken.md), --json is currently the only way to see the full data - making it a workaround for a rendering bug as well as a scripting gap."
---

# UX: provider list has no --json flag

## Summary

provider list --json is unknown; only design-system table available for scripting.

## Evidence

```bash
$ poe-code provider list --json
error: unknown option '--json'
```

## Why it matters

CI cannot machine-parse provider status.

## Suggested direction

Add --json with status, env, agents fields.

## Severity

Medium

## Area

Providers
