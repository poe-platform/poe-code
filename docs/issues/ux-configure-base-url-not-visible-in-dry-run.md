---
severity: high
impact: correctness
comment: "Twin of ux-configure-base-url-may-be-ignored.md framed as a dry-run fidelity gap rather than a functional one; merge and resolve the hypothesis first. If dry-run simply is not rendering the override, this is the more accurate framing and the fix is to show the effective base URL. Related to ux-configure-shape-base-url-not-visible-in-dry-run.md, which reports the same for --shape-base-url; one fix should cover both."
reproduced: y
recommendation: fix
evidence: "npm run dev -- configure claude --base-url https://example.invalid --yes --dry-run prints ANTHROPIC_BASE_URL https://api.poe.com; src/cli/commands/shared.ts:110-114 derives agentBaseUrl from env/provider.agentBaseUrl only, ignoring explicitBaseUrl, and src/providers/claude-code.ts:116 prefers agentBaseUrl"
---

# UX: configure --base-url override not visible in dry-run

## Summary

configure --base-url https://example.invalid --yes --dry-run still shows ANTHROPIC_BASE_URL https://api.poe.com — override not reflected in dry-run (related shape-base-url opacity).

## Evidence

--base-url example.invalid dry-run still +ANTHROPIC_BASE_URL api.poe.com

## Why it matters

Users cannot verify base URL override from dry-run.

## Suggested direction

Show effective base URL in intentional dry-run.

## Severity

**High**

## Area

Configure / dry-run
