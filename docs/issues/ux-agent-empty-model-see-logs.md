---
severity: medium
impact: usability
comment: "Valid and cheap: 'createAgentSession' is an internal symbol leaking into user-facing copy, and 'See logs' points at logs that add nothing for a validation failure. Same shape as ux-agent-empty-prompt-see-logs.md; both are instances of the systemic UserError-vs-system-chrome cleanup tracked by ux-user-errors-look-like-system-failures.md. Fix the error classification centrally, not by rewording this one string."
---

# UX: agent --model "" fails with createAgentSession message + See logs

## Summary

agent --model "" → Missing model. Provide a non-empty model to createAgentSession + See logs — internal API phrasing leaks.

## Evidence

Missing model. Provide a non-empty model to createAgentSession.

## Why it matters

User-facing copy should not mention createAgentSession.

## Suggested direction

Model must not be empty. Pass --model <id>.

## Severity

Medium

## Area

Agent
