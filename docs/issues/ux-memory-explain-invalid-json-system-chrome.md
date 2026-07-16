---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "explain.ts:90-91 prompt asks for prose paragraphs but explain.ts:52 passes stdout to parseMemoryAgentResponse, which throws plain Error 'Memory agent returned invalid JSON output.' at agent-response.ts:12; not a CliError userError, so bootstrap.ts:71-77 prints 'See logs at .../errors.log'; memory.ts:418-423 exposes --agent but no --model"
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
