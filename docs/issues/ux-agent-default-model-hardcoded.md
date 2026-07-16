---
severity: low-medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/agent.ts:22 interpolates ${DEFAULT_FRONTIER_MODEL} (src/cli/constants.ts:9) into help text, so 'agent --help' output 'Model identifier (default: anthropic/claude-opus-4.7)' is derived at runtime, not hard-coded; the asked-for fix already exists and the stale-default argument duplicates ux-agent-default-opus-4-7-not-latest-opus-4-8.md"
comment: "Near-contentless filing (Summary is just the default string; Why is 'Stale/cost.'). Same observation as ux-agent-default-opus-4-7-not-latest-opus-4-8.md, which actually argues it with catalog evidence - merge there and retire this. If kept, the concrete ask is to render the help default from DEFAULT_FRONTIER_MODEL at runtime so help cannot drift from behavior."
---

# UX: agent help hard-codes opus

## Summary

default anthropic/claude-opus-4.7.

## Evidence

agent --help.

## Why it matters

Stale/cost.

## Suggested direction

Resolve live.

## Severity

Low–Medium

## Area

Agent defaults
