# UX: --detach --runtime host still runs inline without job id

## Summary

spawn … --detach --runtime host still prints ✓ agent and Resume line like normal spawn — no detached job id; detach+host may be no-op or not surface job metadata.

## Evidence

```bash
$ poe-code spawn claude "ok" --mode read --model haiku --detach --runtime host
✓ agent: ok
●  Resume: claude --resume …
# no job id
```

## Why it matters

Users expect background job when both flags set.

## Suggested direction

Return job id; or error detach requires docker/e2b; document host detach semantics.

## Severity

**High**

## Area

Spawn / runtime
