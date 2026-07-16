---
severity: high
impact: usability
comment: "Third duplicate within the endpoint-stack cluster; retire into ux-models-endpoint-bogus-double-error-and-stack.md. No distinct content beyond confirming the stack trace reaches stderr."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:400 throws ValidationError, caught at models.ts:542 logException; src/cli/logger.ts:180 forwards to ErrorLogger built with logToStderr:true (src/cli/container.ts:91), and src/cli/error-logger.ts:151 appends 'Stack trace:' to the stderr entry with no isUserError check"
---

# UX: models invalid --endpoint prints ValidationError stack

## Summary

models --endpoint /v1/bogus: good message listing available endpoints, but also ERROR log line + full stack trace to stderr.

## Evidence

Unsupported endpoint … Available endpoints: …
Stack trace: ValidationError at models.ts…

## Why it matters

Validation should not dump stacks.

## Suggested direction

UserError without stack; keep available endpoints list.

## Severity

**High**

## Area

Models
