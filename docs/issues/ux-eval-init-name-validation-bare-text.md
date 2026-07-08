# UX: eval init invalid name is bare text without design-system

## Summary

eval init /tmp/ux-eval-test fails with bare Eval name must be kebab-case… without panel framing or examples of valid names.

## Evidence

```bash
$ poe-code eval init /tmp/ux-eval-test --kind plan
Eval name must be kebab-case: lowercase letters, digits, and dashes; start with a letter.
```

## Why it matters

Path-like names common mistake; recovery incomplete.

## Suggested direction

ValidationError with example: my-eval; design-system frame.

## Severity

Medium

## Area

Eval
