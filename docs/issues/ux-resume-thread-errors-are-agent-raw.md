---
severity: medium
impact: usability
comment: "Contentless twin of ux-resume-thread-invalid-agent-raw-error.md; retire into it. The shared point is right: a poe-code flag should be validated at the poe-code layer rather than surfacing the underlying agent's usage text, which mentions concepts (session titles, UUIDs) the poe-code user never saw."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-spawn/src/spawn.ts:185-198 getResumeArgs passes resumeThreadId straight into CLI args with no id validation, so the agent's own error surfaces; only src/providers/poe-agent.ts:745-747 validates. Duplicate of ux-resume-thread-invalid-agent-raw-error.md."
---

# UX: resume-thread-id raw agent error

## Summary

Long agent usage text.

## Evidence

--resume-thread-id not-real.

## Why it matters

Product flag.

## Suggested direction

Pre-validate.

## Severity

Medium

## Area

Spawn
