# UX: braintrust status only says disabled (opaque)

## Summary

braintrust status prints disabled with Problems footer — no how to enable, env vars, or docs link (reaffirm braintrust-status-opaque).

## Evidence

```bash
$ poe-code braintrust status
●  disabled
```

## Why it matters

Users cannot act on disabled.

## Suggested direction

Explain enable steps / env; hide Problems on success info.

## Severity

Low–Medium

## Area

Braintrust
