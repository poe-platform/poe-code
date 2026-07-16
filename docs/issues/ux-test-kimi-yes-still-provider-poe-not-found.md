---
severity: high
impact: correctness
comment: "Third filing within the kimi provider-config cluster; retire into ux-test-kimi-invalid-config-provider-poe-not-found.md. Its contribution is ruling out an explanation: --yes does not help, so the failure is not a prompt or confirmation issue but a genuinely malformed config that configure wrote."
reproduced: n
recommendation: no-fix
evidence: "src/providers/kimi.ts:118-127 configure writes providers.poe (type openai_legacy, base_url, api_key) alongside default_model, so no missing-provider block is visible statically; 'npm run dev -- test kimi --yes --dry-run' succeeds and shows --yes only affects prompting, never config content. Duplicate reconfirm of ux-test-kimi-invalid-config-provider-poe-not-found.md."
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
