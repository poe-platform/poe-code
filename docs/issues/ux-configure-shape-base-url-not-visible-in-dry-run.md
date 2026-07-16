---
severity: high
impact: correctness
comment: "Same unresolved ambiguity as the --base-url pair (flag ignored versus dry-run not rendering it); merge with ux-configure-base-url-not-visible-in-dry-run.md into one issue covering both flags. The sonnet-5 default it also shows is incidental noise from omitting --model, not part of this defect. Resolve by configuring for real and inspecting the written value before scheduling."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/shared.ts:111-113 computes agentBaseUrl from provider.agentBaseUrl and ignores explicitShapeBaseUrls; src/providers/claude-code.ts:75 maps ANTHROPIC_BASE_URL to agentBaseUrl, so dry run of 'configure claude --shape-base-url anthropic-messages=https://example.invalid --yes --dry-run' still writes ANTHROPIC_BASE_URL https://api.poe.com"
---

# UX: configure --shape-base-url not visible in dry-run diff

## Summary

configure claude --shape-base-url anthropic-messages=https://example.invalid --yes --dry-run still shows ANTHROPIC_BASE_URL https://api.poe.com and dead sonnet-5 default when no --model — shape override not clearly reflected in intentional diff.

## Evidence

shape-base-url example.invalid dry-run still shows api.poe.com base URL; model sonnet-5.

## Why it matters

Users cannot verify shape URL override from dry-run.

## Suggested direction

Show shape/base URL overrides in intentional dry-run; require --model to avoid dead default noise.

## Severity

**High**

## Area

Configure / dry-run
