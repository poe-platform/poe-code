---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
comment: "Duplicate within the maestro --config/--workflow trio; retire into ux-maestro-config-vs-workflow-flags-duplicated.md, which additionally notes the root/tui divergence. No distinct content."
evidence: "src/cli/program.ts:640-641 maestro tui declares --config and --workflow both described 'Path to WORKFLOW.md', both feeding workflowPath (program.ts:651-653); behaviour real but already tracked by ux-maestro-config-vs-workflow-flags-duplicated.md (reproduced=y, recommendation=fix)."
---

# UX: maestro tui has both --config and --workflow for same path

## Summary

maestro tui --help lists --config Path to WORKFLOW.md and --workflow Path to WORKFLOW.md — duplicate flags for same purpose.

## Evidence

--config <path> Path to WORKFLOW.md
--workflow <path> Path to WORKFLOW.md

## Why it matters

Duplicate options confuse users and docs.

## Suggested direction

Single flag; alias the other.

## Severity

Medium

## Area

Maestro
