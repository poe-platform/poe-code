---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/utils/command-checks.ts:214,220 embed formatCommandRunnerResult (full raw stdout/stderr, JSONL for stream agents) in the thrown health-check error; src/cli/bootstrap.ts:70-79 prints it (truncated at 1200 chars) plus 'See logs at .../errors.log'; no --verbose gate exists on src/cli/commands/test.ts"
comment: "Real and worth High: a health check exists to answer one question and it answers with a JSONL flood plus a log pointer, so the command's entire purpose is defeated on the path that matters most - failure. Its fix is right (short summary, stream behind --verbose). Same shape as ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md, so one decision covers both: machine streams are opt-in, humans get a verdict."
---

# UX: Failed test dumps raw agent JSONL

## Summary

test failure inlines hook JSONL flood.

## Evidence

test --yes → JSONL + See logs.

## Why it matters

Health-check unreadable.

## Suggested direction

Short summary; verbose for stream.

## Severity

**High**

## Area

Test / errors
