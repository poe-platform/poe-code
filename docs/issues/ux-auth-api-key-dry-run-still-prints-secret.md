---
severity: critical
impact: security
comment: "Keep as canonical of the four-file cluster; correctly Critical and the sharpest framing in the whole auth set. The defect is not that a reveal command reveals - it is that --dry-run, the flag users reach for precisely to check something safely, is silently ignored for the one command whose output is a credential. The whoami --dry-run contrast in the evidence proves dry-run is honoured elsewhere, making this an inconsistency rather than a missing feature. Fix: --dry-run must never emit secret material; print a would-display line instead."
---

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
