---
severity: low-medium
impact: discoverability
comment: "Duplicate within the 'disabled is opaque' trio; retire into one consolidated issue. Its only distinct point - the Problems footer appearing on a plain info result - belongs to ux-problems-footer-on-every-success.md, not here. The trio spans Medium / Low-Medium / Low for identical behavior; normalise on merge."
---

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
