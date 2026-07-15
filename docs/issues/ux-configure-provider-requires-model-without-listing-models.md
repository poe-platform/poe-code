---
severity: medium
impact: usability
comment: "Valid: the error correctly identifies what is missing but leaves the user no way to find the answer - the recurring 'right diagnosis, no recovery' shape in this audit. Cheap, and the precedent already exists in the same command: ux-configure-unknown-api-shape-lists-exposed.md shows configure listing valid shapes on error, so mirror that and list candidate models or point at models --provider."
---

# UX: configure --provider cloudflare requires --model without listing candidates

## Summary

When a provider requires an explicit model, configure errors Pass --model without listing available models, defaults, or models --provider cloudflare example.

## Evidence

```bash
$ poe-code configure claude --provider cloudflare --yes --dry-run
■  Error: Provider "cloudflare" requires a model for "Claude Code default model". Pass --model.
```

## Why it matters

User knows they need a model but not which; recovery incomplete.

## Suggested direction

Include example models or `poe-code models --provider cloudflare --tools`; ValidationError.

## Severity

Medium

## Area

Configure
