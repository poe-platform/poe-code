---
severity: high
impact: correctness
reproduced: n
recommendation: no-fix
evidence: "src/providers/kimi.ts:104-127 configure writes default_model and providers.poe in the same transform; src/providers/providers.test.ts:1126-1136 asserts both are written, so no internally inconsistent config is produced by current code"
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
