---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- test pi and test poe-agent both print 'Error: Unknown agent' while spawn --help lists pi/poe-agent; src/cli/commands/shared.ts:491 throws, src/cli/container.ts:250 filters disabled providers"
comment: "Duplicate within the spawn-only messaging family; retire into ux-install-test-pi-unknown-not-spawn-only.md or the capability-matrix canonical. Its four-word argument is the best in the family and should survive: 'Unknown implies typo' - the message does not merely fail to help, it actively misdirects the user into checking their spelling."
---

# UX: test/install call spawn-only agents Unknown agent

## Summary

poe-agent/pi fail test/install with Unknown agent (false).

## Evidence

test poe-agent → Unknown agent.

## Why it matters

Unknown implies typo.

## Suggested direction

Capability-aware: spawn-only.

## Severity

**High**

## Area

Agents
