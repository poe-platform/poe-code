---
severity: medium
impact: discoverability
comment: "Keep as the allow-list ask for plan install and pair with ux-plan-install-pi-clearer-than-unknown.md: the noun is already right ('Unsupported'), only the list of supported agents is missing. Its kimi observation is the interesting one - kimi is configurable elsewhere but unsupported here, exactly the per-command divergence ux-agent-capability-matrix-spawn-vs-configure-vs-install.md wants a single source for."
---

# UX: plan install rejects pi and kimi as Unsupported agent

## Summary

plan install --agent pi|kimi --local --yes: Unsupported agent — no capability matrix message; pi is spawn-only; kimi is configurable for other surfaces.

## Evidence

Unsupported agent: pi
Unsupported agent: kimi

## Why it matters

Should list supported agents; capability matrix consistency.

## Suggested direction

Unsupported agent for plan skill. Expected: claude-code, …

## Severity

Medium

## Area

Plan install
