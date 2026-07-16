---
severity: medium
impact: security
comment: "Canonical filing for agent --api-key exposure. Same defect class as configure --api-key and provider login --api-key, so it should not be fixed locally: one decision (prefer POE_API_KEY/stdin, warn when the flag is used, document the env var) applied across all three surfaces. Overlaps part (a) of ux-agent-api-key-and-stale-default-model.md."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/agent.ts:23 registers .option('--api-key <key>', 'Poe API key'); `npm run dev -- agent --help` prints '--api-key <key>  Poe API key' with no POE_API_KEY mention and no warning when the flag is passed (agent.ts:48 forwards options.apiKey unwarned)."
---

# UX: agent --help advertises --api-key (shell history risk)

## Summary

agent --help lists --api-key <key> — encourages passing secrets on CLI (history/process list leak class).

## Evidence

Options: --api-key <key> Poe API key

## Why it matters

Reconfirm API key flags encourage shell history leaks.

## Suggested direction

Prefer env/login; warn if flag used; document POE_API_KEY.

## Severity

Medium

## Area

Agent / security
