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
