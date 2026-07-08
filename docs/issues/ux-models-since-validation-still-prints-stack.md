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
