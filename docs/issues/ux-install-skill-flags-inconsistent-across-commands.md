---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "All five contracts verified: src/cli/commands/skill.ts:93-95 (-y/--local/--global); src/cli/commands/memory.ts:445-452 (requiredOption --agent, --global/--skill-only/--mcp-only/--allow-writes, no --local); src/cli/commands/pipeline.ts:1394-1397 and src/cli/commands/experiment.ts:1103-1106 (--local/--global/--force); src/cli/commands/plan.ts:757-759 (--local/--global only); packages/superintendent/src/commands/install.ts:41-53 toolcraft S.Enum scope. Probe 'npm run dev -- superintendent install --help' prints '--scope <value> (values: local, global)' with usage 'npm run dev -- superintendent install', vs 'npm run dev -- pipeline install --help' printing --local/--global/--force with usage 'poe-code pipeline install' - divergent flags and help identity confirmed."
comment: "Excellent systemic filing, correctly High: five installers implement one concept with five flag contracts (--local/--global/--yes; --global/--skill-only/--mcp-only; --local/--global/--force; --scope local|global; --local/--global), so no CI script can share flags and no user can transfer knowledge between them. Evidence is concrete and complete. Keep as the umbrella for installer flag consistency alongside ux-experiment-install-already-exists-vs-pipeline-skip.md for idempotency: one settles the flags, the other the semantics."
---

# UX: skill install flags differ across skill/memory/pipeline/experiment/plan/superintendent

## Summary

Skill-related install commands use inconsistent flag sets: skill install has --local/--global/--yes; memory install has --global/--skill-only/--mcp-only (no --local); pipeline/experiment have --local/--global/--force; plan has --local/--global; superintendent uses --scope local|global and defaults agent, with toolcraft help identity.

## Evidence

skill install: --local --global -y
memory install: --global --skill-only --mcp-only (no --local)
pipeline install: --local --global --force
superintendent install: --scope local|global (toolcraft help, npm run dev)
plan install: --local --global

## Why it matters

Same product concept (install skill) has five contracts; CI scripts cannot share flags.

## Suggested direction

Unify scope flags (--local/--global or --scope) and --force/--yes across installers; one help identity.

## Severity

**High**

## Area

Skills / consistency
