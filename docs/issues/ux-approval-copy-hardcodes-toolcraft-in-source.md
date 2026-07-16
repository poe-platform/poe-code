---
severity: high
impact: usability
comment: "Keep as the fix location: it names the hard-coded strings (packages/toolcraft/src/cli.ts and mcp.ts) behind the symptom reported in ux-approval-queued-message-says-toolcraft.md. High is right - the copy tells a poe-code user to run a 'toolcraft' command to unblock themselves, so the recovery path is wrong, not merely mislabelled. Fix by injecting the host product/binary name."
reproduced: y
recommendation: fix
evidence: "packages/toolcraft/src/cli.ts:4053 renderHumanInLoopPending writes 'Track:   toolcraft approvals show ${pending.approvalId}'; packages/toolcraft/src/mcp.ts:463 renderPendingApproval writes 'Track with `toolcraft approvals show ${pending.approvalId}`'. Both literals ignore the existing inferProgramName helper at cli.ts:390-399, so poe-code hosts print an unrunnable toolcraft recovery command."
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
