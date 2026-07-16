---
severity: medium
impact: security
comment: "Contentless duplicate within the --log-content trio; retire into ux-log-content-flag-no-danger-warning.md."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:131 --log-content help reads only 'Include message and tool content in ACP JSONL spawn logs'; no secret/sensitive/PII string anywhere in spawn.ts. Real but duplicate: canonical is ux-log-content-flag-no-danger-warning.md. Default redacts (packages/agent-spawn/src/acp/middlewares/spawn-log.ts:188-203), so warning gap not leak."
---

# UX: log-content under-warns secrets

## Summary

--log-content no PII warning.

## Evidence

spawn help.

## Why it matters

CI leak risk.

## Suggested direction

Mark sensitive.

## Severity

Medium

## Area

Privacy
