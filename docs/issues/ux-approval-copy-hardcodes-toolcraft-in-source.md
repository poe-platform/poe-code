---
severity: high
impact: usability
comment: "Keep as the fix location: it names the hard-coded strings (packages/toolcraft/src/cli.ts and mcp.ts) behind the symptom reported in ux-approval-queued-message-says-toolcraft.md. High is right - the copy tells a poe-code user to run a 'toolcraft' command to unblock themselves, so the recovery path is wrong, not merely mislabelled. Fix by injecting the host product/binary name."
---

# UX: Approval copy hardcodes toolcraft in source

## Summary

Confirmed packages/toolcraft/src/cli.ts and mcp.ts hardcode toolcraft approvals.

## Evidence

Source strings.

## Why it matters

poe-code hosts surface.

## Suggested direction

Parameterize productName.

## Severity

**High**

## Area

Approvals / recovery
