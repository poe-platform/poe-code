---
severity: low
impact: none
comment: "Positive pattern; consolidate with ux-skill-configure-kimi-not-supported-clear.md. Its contrast is the most useful in the capability-matrix story: skill configure says 'Skills not supported for pi' while configure says 'Unknown agent pi' for the same agent - so the product already knows pi exists, and one command admits it while another denies it. That single comparison is the strongest evidence for ux-agent-capability-matrix-spawn-vs-configure-vs-install.md."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:123 throws 'Skills not supported for ${support.id}.' when packages/agent-skill-config/src/configs.ts:61 returns unsupported for known-but-unlisted agents; pi/poe-agent are registered in packages/agent-defs/src/agents/ but absent from agentSkillConfigs (configs.ts:12-36) - message is correct, no defect"
---

# UX: skill configure pi/poe-agent says Skills not supported (positive-ish)

## Summary

skill configure pi/poe-agent: Skills not supported for pi/poe-agent — clear capability message (contrast configure agent Unknown).

## Evidence

■  Skills not supported for pi.
■  Skills not supported for poe-agent.

## Why it matters

Positive capability messaging for skills; extend to configure/install.

## Suggested direction

Use same phrasing for configure: pi is spawn-only.

## Severity

Low

## Area

Skills / positive pattern
