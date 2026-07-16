---
severity: high
impact: usability
comment: "Keep as canonical of the four-file endpoint-stack cluster: the only one catching both defects - the stack trace and the double panel (the error renders twice, once as 'Error during models' and once as the ValidationError). The double render suggests the same handler-runs-twice bug as ux-approvals-missing-id-says-task-not-found-double.md; worth checking whether they share a cause. The message content is excellent, which makes presentation the whole problem."
reproduced: y
recommendation: fix
evidence: "models.ts:400 throws ValidationError; models.ts:540-547 catch calls logger.logException (logger.ts:171-190 emits 'Error during models: <msg>') then rethrows, and bootstrap.ts:52-72 catch prints the message again via log.error - double panel. Stack trace: container.ts:88-92 builds ErrorLogger with logToStderr true, so error-logger.ts:63-69 writeToStderr plus formatEntry at line 151 append 'Stack trace:\\n<stack>' for this user ValidationError."
---

# UX: models --endpoint bogus prints stack and double error panel

## Summary

models --endpoint bogus: good Available endpoints message but ERROR log + ValidationError stack + Error during models panel then second Unsupported endpoint panel.

## Evidence

```bash
$ poe-code models --endpoint bogus
■  Error during models: Unsupported endpoint "/bogus". Available endpoints: …
Stack trace: ValidationError at models.ts:400
■  Unsupported endpoint "/bogus". Available endpoints: …
```

## Why it matters

Validation should not dump stacks or double-render.

## Suggested direction

Single UserError/ValidationError without stack.

## Severity

**High**

## Area

Models
