---
severity: high
impact: usability
comment: "Duplicate within the endpoint-stack cluster; retire into ux-models-endpoint-bogus-double-error-and-stack.md. Its framing is the most useful line in the cluster and should survive: 'recovery content is excellent; stack ruins it' - the fix is subtractive, not additive."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:400-402 throws ValidationError with 'Available endpoints' list; models.ts:542 calls logger.logException which emits 'Error during models: ...' (src/cli/logger.ts:163) then ErrorLogger prints 'Stack trace:' to stderr (src/cli/error-logger.ts:150-163) since src/cli/container.ts:91 sets logToStderr: true and ValidationError is not silent (src/cli/errors.ts:70-74, 169-180). Duplicate of ux-models-endpoint-bogus-double-error-and-stack.md."
---

# UX: models --endpoint invalid lists available endpoints but still prints stack

## Summary

Unsupported endpoint message lists Available endpoints (good) but still ERROR log + ValidationError stack — mixed quality.

## Evidence

```bash
$ poe-code models --endpoint /v1/bogus
■  Error during models: Unsupported endpoint "/v1/bogus". Available endpoints: …
# + Stack trace
```

## Why it matters

Recovery content is excellent; stack ruins it.

## Suggested direction

Keep message; drop stack for ValidationError.

## Severity

**High**

## Area

Models / errors
