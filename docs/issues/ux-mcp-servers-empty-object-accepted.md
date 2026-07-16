---
severity: low-medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/mcp-spawn-config.ts:141 returns undefined for an empty server map with no error/warning; src/cli/commands/spawn.ts:189,261 then omit mcpServers entirely, so '{}' runs as a silent no-op."
comment: "The only non-positive in the --mcp-servers set and the one worth keeping: '{}' is valid JSON and silently configures nothing, so a user who mis-serialised their config gets a successful run with no servers. Same empty-input family as ux-empty-model-flag-behavior-inconsistent.md - the shared rule (an explicitly passed flag must not resolve to a no-op) covers it. Note the contrast the positives establish: this flag validates shape meticulously and then accepts a semantically empty value."
---

# UX: --mcp-servers {} is accepted as no-op

## Summary

spawn with --mcp-servers {} succeeds without warning that no servers were configured — empty object is valid JSON but likely a mistake.

## Evidence

```bash
$ poe-code spawn … --mcp-servers '{}'
# succeeds
```

## Why it matters

Silent empty config footgun.

## Suggested direction

Warn if zero servers when flag present; or require at least one entry.

## Severity

Low–Medium

## Area

Spawn
