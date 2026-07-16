---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/configure.ts:35,1026 --yes falls back to DEFAULT_SERVICE_AGENT 'claude-code' silently; src/utils/command-checks.ts:15-19,213-215 spawn health check throws with untruncated formatCommandRunnerResult stdout (claude stream-json JSONL). Duplicate of ux-test-failure-dumps-jsonl.md plus silent-default family."
comment: "Two known families in one transcript: the silent default agent (--yes picks claude) and the JSONL flood on failure. Retire into ux-test-failure-dumps-jsonl.md and the silent-defaults rule. Its evidence is the best in the test cluster though - hook_started JSONL dumped as the failure output - and worth carrying: the flood is not the agent's stderr but its structured event stream, which nobody would want as an error message."
---

# UX: test --yes defaults to claude and dumps JSONL on failure

## Summary

test --yes without agent defaults to claude-code; failure dumps long hook JSONL stdout and See logs — health check noise unusable.

## Evidence

```bash
$ poe-code test --yes
■  Error: spawn claude-code failed with exit code 1.
│  stdout: {"type":"system","subtype":"hook_started",… long JSONL …
```

## Why it matters

Health check should summarize failure; silent default agent; no JSONL flood.

## Suggested direction

Require agent non-TTY; summarize stderr; UserError without logs dump.

## Severity

**High**

## Area

Test
