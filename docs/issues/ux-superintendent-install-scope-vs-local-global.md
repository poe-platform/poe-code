---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "Confirmed: packages/superintendent/src/commands/install.ts:46-49 declares scope S.Enum([local, global]); probe 'npm run dev -- superintendent install --help' prints '--scope <value> (values: local, global) (default: local)'. Peers use --local/--global: src/cli/commands/pipeline.ts:1395-1396, src/cli/commands/experiment.ts:1104-1105, src/cli/commands/plan.ts:758-759. Divergence exists today, but the claim is already fully covered by umbrella doc ux-install-skill-flags-inconsistent-across-commands.md (reproduced=y, recommendation=fix), so this duplicate is no-fix."
comment: "Duplicate within the installer-flags family; retire into ux-install-skill-flags-inconsistent-across-commands.md, which documents all five contracts including this one. Its alias suggestion is the pragmatic fix - keep --scope working while standardising on --local/--global."
---

# UX: superintendent install uses --scope while others use --local/--global

## Summary

superintendent install --scope local|global (npm run dev help); experiment/pipeline use --local/--global — unified installer flags gap reconfirmed.

## Evidence

superintendent: --scope; experiment/pipeline: --local/--global.

## Why it matters

Users cannot transfer flag knowledge across installers.

## Suggested direction

Unified --local/--global everywhere; alias --scope.

## Severity

**High**

## Area

Install / flags
