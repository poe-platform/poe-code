---
severity: high
impact: usability
comment: "Reconfirm of ux-models-since-invalid-prints-stack.md; retire into it. Its framing is the most useful and should survive: this is an instance of the general rule in ux-validation-error-still-prints-stack.md - no stack for a ValidationError unless --verbose - which is the one fix that closes the whole stack-leak family."
---

# UX: models --since invalid still prints stack (reconfirmed ValidationError stack)

## Summary

Invalid --since still dumps ERROR log + ValidationError stack + design-system error — reconfirm of validation-error-still-prints-stack on models path.

## Evidence

```bash
$ poe-code models --since notaduration
[…] ERROR: Invalid --since…
Stack trace:
ValidationError: …
■  Invalid --since duration "notaduration". …
```

## Why it matters

Reconfirmed stack leak on ValidationError.

## Suggested direction

UserError path: message only; no stack unless --verbose.

## Severity

**High**

## Area

Errors
