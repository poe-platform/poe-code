---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/providers/gemini-cli.ts:87 maps GEMINI_API_KEY to providerCredential in isolatedEnv, but the test health check at src/providers/gemini-cli.ts:105-111 invokes the raw gemini binary with only env GEMINI_SANDBOX=false, so no Poe credential reaches it; premise that gemini is not wired to Poe at all is wrong - only the test path skips injection"
comment: "The clearest statement of the gemini problem and it reframes the whole gemini cluster: test demands GEMINI_API_KEY, so gemini-cli is not wired to Poe credentials at all - which means ux-spawn-gemini-provider-credential-opaque-error.md is a capability gap wearing an error message, not a copy defect. Consolidate the gemini filings under this reading and answer the product question first: is gemini meant to work via Poe? The correct error text depends entirely on the answer."
---

# UX: test gemini demands GEMINI_API_KEY not Poe credential

## Summary

test gemini fails: When using Gemini API, you must specify the GEMINI_API_KEY — does not use Poe auth after configure.

## Evidence

stderr: When using Gemini API, you must specify the GEMINI_API_KEY environment variable.

## Why it matters

Reconfirm gemini credential path not Poe-managed for health check.

## Suggested direction

Configure should inject Poe-backed key/env; test should use it.

## Severity

**High**

## Area

Test / gemini
