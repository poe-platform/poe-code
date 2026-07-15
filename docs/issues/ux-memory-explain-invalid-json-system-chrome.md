---
severity: high
impact: usability
comment: "Duplicate of ux-memory-agent-commands-invalid-json-opaque.md, which covers explain and query together; retire into it. Its 'optional --model' suggestion is a good diagnostic affordance and worth carrying, especially if the dead-default-model hypothesis proves correct."
---

# UX: memory explain fails with invalid JSON agent output + See logs

## Summary

memory explain pages/hello.md: Memory agent returned invalid JSON output + See logs — agent failure unframed.

## Evidence

■  Error: Memory agent returned invalid JSON output.
●  See logs …

## Why it matters

Explain should degrade gracefully or UserError with retry.

## Suggested direction

UserError; optional --model; no See logs.

## Severity

**High**

## Area

Memory
