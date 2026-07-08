# UX: test --help omits pi and poe-agent (spawn-only agents)

## Summary

test agent list ends at opencode — no pi/poe-agent; spawn lists them; test pi would be unknown vs spawn-only messaging.

## Evidence

test agents: claude…opencode (no pi, no poe-agent)
spawn agents include pi, poe-agent

## Why it matters

Reconfirm capability matrix; test should say spawn-only not unknown.

## Suggested direction

Capability matrix messaging.

## Severity

Medium

## Area

Test / capability
