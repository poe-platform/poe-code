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
