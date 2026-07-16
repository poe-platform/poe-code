---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "src/cli/options.ts:205-208 resolveModel returns --model value unvalidated; src/sdk/spawn.ts:192-193 + packages/poe-code-config/src/models.ts:30-35 read configured model with no catalog preflight, so bad ids reach the API"
comment: "Good framing of the cost the sonnet-5 cluster imposes: a bad model id is accepted at configure and only surfaces mid-run as an API 400 dressed in success glyphs, so users pay setup time before learning anything. Its two fixes are the ones the cluster converges on - validate on configure (ux-configure-accepts-any-string-as-model-no-catalog-check.md) and preflight before spawn. Retire into those, keeping the late-failure argument as the justification."
---

# UX: Stale configured models fail only at run time

## Summary

Invalid configured model ids only fail mid gaslight/pipeline with API 400 and success checkmarks.

## Evidence

✓ agent: API Error: 400 Unsupported model claude-sonnet-5.

## Why it matters

Late failure wastes setup.

## Suggested direction

Validate on configure; preflight; user error with reconfigure hint.

## Severity

**High**

## Area

Config / models
