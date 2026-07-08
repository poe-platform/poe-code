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
