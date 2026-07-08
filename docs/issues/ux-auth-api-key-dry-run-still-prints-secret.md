# UX: auth api-key --dry-run still prints the full secret

## Summary

Even with global --dry-run, auth api-key writes the real API key. whoami --dry-run only says would fetch identity.

## Evidence

```bash
$ poe-code auth api-key --dry-run
sk-poe-<full-secret>
```

## Why it matters

False sense of safety with --dry-run.

## Suggested direction

Under --dry-run print masked key or would-display message.

## Severity

**Critical**

## Area

Auth / dry-run
