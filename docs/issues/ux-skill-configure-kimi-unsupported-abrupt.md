---
severity: medium
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:223 throws ValidationError('Skills not supported for ${support.id}.'); kimi absent from agentSkillConfigs in packages/agent-skill-config/src/configs.ts:12-35"
comment: "Directly contradicts ux-skill-configure-kimi-not-supported-clear.md, which praises this same message as clear capability signalling - and the positive reading is the better one: naming the agent and the unsupported capability is exactly right. The only fair residue is its own suggestion to list the supported agents, which belongs with ux-skill-configure-agent-list-differs-from-configure.md. Retire."
---

# UX: skill configure kimi abrupt

## Summary

Skills not supported for kimi.

## Evidence

skill configure kimi.

## Why it matters

Matrix.

## Suggested direction

List supported.

## Severity

Medium

## Area

Skills / agents
