---
severity: high
impact: correctness
comment: "Reconfirm of ux-test-kimi-invalid-config-provider-poe-not-found.md; retire into it, carrying its more specific evidence: the error quotes input_value with 'default_model': 'poe/ki...' from ~/.kimi/config.toml, which pins the inconsistency precisely - the model id names a poe provider the providers table lacks. That detail is what makes this actionable."
---

# UX: test kimi Provider poe not found (reconfirmed)

## Summary

test kimi: Invalid configuration file ~/.kimi/config.toml — Provider poe not found in providers — reconfirm kimi credential/config path broken.

## Evidence

Provider poe not found in providers [type=value_error, input_value={'default_model': 'poe/ki…

## Why it matters

Reconfirm kimi not Poe-wired for health check.

## Suggested direction

configure kimi must write valid providers.poe; test uses it.

## Severity

**High**

## Area

Test / kimi
