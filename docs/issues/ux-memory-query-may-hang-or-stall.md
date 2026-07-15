---
severity: medium
impact: crash
comment: "Explicitly inconclusive by its own admission ('probe did not complete in batch window') and should not be scheduled as filed - it needs a bounded re-run. Its likely explanation is already documented: ux-memory-agent-commands-invalid-json-opaque.md shows the memory agent path failing, plausibly on the dead default model, so the 'hang' may be an agent spawn stuck behind a bad model rather than a memory bug. Its ask is sound regardless: fail fast non-TTY and bound the wait."
---

# UX: memory query after init may hang (probe inconclusive)

## Summary

memory query "what is this" --yes after init did not return quickly in batch; may hang on agent spawn without init content or non-TTY issues — needs follow-up with timeout.

## Evidence

memory query --yes after init: probe did not complete in batch window; process killed.

## Why it matters

Non-TTY memory query should fail-fast with requirements or timeout.

## Suggested direction

Require agent/model; fail-fast non-TTY; spinner + timeout.

## Severity

Medium

## Area

Memory
