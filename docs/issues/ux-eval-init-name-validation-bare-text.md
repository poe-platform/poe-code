---
severity: medium
impact: usability
comment: "Distinct from the bare-success cluster and reasonable: the kebab-case rule is stated correctly but unframed and without an example, and the trigger is a realistic mistake (passing a path where a name is expected). The better fix is to detect the path-like input specifically and say so, rather than restating the naming rule - that is what the user actually got wrong. Precedent for the shape: ux-configure-unknown-api-shape-lists-exposed.md."
---

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
