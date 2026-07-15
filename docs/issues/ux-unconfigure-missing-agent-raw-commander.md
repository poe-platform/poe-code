---
severity: medium
impact: usability
comment: "Two known families: raw-Commander missing argument (ux-raw-commander-missing-args.md) and the unknown-agent message without an allow-list (ux-unknown-agent-no-allow-list-or-suggestions.md). Retire into those. Its point that a destructive command in particular should list valid agents is fair - the cost of guessing is higher here."
---

# UX: unconfigure without agent is raw commander error

## Summary

unconfigure without agent: error: missing required argument agent — raw commander; unconfigure not-an-agent has See logs.

## Evidence

```bash
$ poe-code unconfigure
error: missing required argument 'agent'
$ poe-code unconfigure not-an-agent
■  Error: Unknown agent "not-an-agent".
●  See logs …
```

## Why it matters

Destructive command should list agents and use design-system.

## Suggested direction

ValidationError with agent list; UserError for unknown.

## Severity

Medium

## Area

Unconfigure
