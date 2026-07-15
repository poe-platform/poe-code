---
severity: high
impact: correctness
comment: "Third filing within the kimi provider-config cluster; retire into ux-test-kimi-invalid-config-provider-poe-not-found.md. Its contribution is ruling out an explanation: --yes does not help, so the failure is not a prompt or confirmation issue but a genuinely malformed config that configure wrote."
---

# UX: test kimi --yes still Provider poe not found (reconfirm)

## Summary

test kimi --yes without model still fails Provider poe not found in ~/.kimi/config.toml — --yes does not fix credential path.

## Evidence

Provider poe not found in providers … default_model poe/ki…

## Why it matters

Reconfirm kimi credential path still broken with --yes.

## Suggested direction

configure kimi must write valid providers.poe; test uses it.

## Severity

**High**

## Area

Test / kimi
