---
severity: medium
impact: usability
comment: "Keep of this pair. Its framing is the accurate one - the inconsistency lives inside a single command's validation, which makes it cheaper to justify than a cross-CLI reskin. Otherwise part of ux-raw-commander-invalid-option-choices.md."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:275-279 uses Commander Option.choices() for --view while --feature/--input use ValidationError (models.ts:195-208); models-command.test.ts:1050-1053 asserts the raw Commander 'Allowed choices are' wording."
---

# UX: models --view invalid uses raw Commander choice error

## Summary

Invalid --view value uses Commander option argument is invalid. Allowed choices… while other models validations use design-system messages.

## Evidence

```bash
$ poe-code models --view invalid
error: option '--view <name>' argument 'invalid' is invalid. Allowed choices are capabilities, pricing, parameters, raw.
```

## Why it matters

Inconsistent validation skin within models command.

## Suggested direction

ValidationError: Expected one of capabilities, pricing, parameters, raw.

## Severity

Medium

## Area

Models
