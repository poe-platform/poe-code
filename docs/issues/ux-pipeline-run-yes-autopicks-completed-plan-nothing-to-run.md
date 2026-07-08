# UX: pipeline run --yes autopicks a plan and reports Nothing to run

## Summary

pipeline run --yes without --plan autopicks docs/plans/tiny-http-mcp-server-production-hardening.md (21/21 done) and finishes with Nothing to run / Pipeline run finished success — silent autopick of completed plan looks like success.

## Evidence

```bash
$ poe-code pipeline run --yes
◇  Plan: docs/plans/tiny-http-mcp-server-production-hardening.md
◇  Tasks: 21/21 done
●  Nothing to run.
◆  Pipeline run finished.
```

## Why it matters

Non-TTY should require --plan or fail if nothing pending; success glyph on no-op confuses.

## Suggested direction

Require --plan non-TTY; if all done: No pending tasks in plan X (exit 0 or 2 policy).

## Severity

**High**

## Area

Pipeline
