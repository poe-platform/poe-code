---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "Wording confirmed but no defect: 'npm run dev -- plan install --agent pi --yes' prints 'Unsupported agent: pi' from src/cli/commands/plan.ts:788, since resolveAgentSupport (packages/agent-skill-config/src/configs.ts:50-62) returns 'unsupported' for pi (registered in packages/agent-defs/src/agents/pi.ts:4, absent from agentSkillConfigs). Positive note; propagating fix belongs to the cited Unknown-agent issues."
comment: "Valuable small positive: 'Unsupported agent: pi' is the correct wording that install and test get wrong with 'Unknown agent' (ux-install-test-pi-unknown-not-spawn-only.md), so the right message already exists in-product and only needs propagating. Cite it from the capability-matrix work as the wording to adopt. Its residual ask (list the supported agents) is covered by ux-plan-install-unsupported-agent-pi-kimi.md."
---

# UX: plan install Unsupported agent is clearer than Unknown agent (positive-ish)

## Summary

plan install pi: Unsupported agent: pi — better than install/test Unknown agent for capability gaps.

## Evidence

Unsupported agent: pi

## Why it matters

Positive phrasing vs Unknown; still needs allow-list.

## Suggested direction

Use Unsupported for capability matrix everywhere; list supported.

## Severity

Low

## Area

Plan install / positive pattern
