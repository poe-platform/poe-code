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
