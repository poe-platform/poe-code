---
severity: medium
impact: usability
comment: "Duplicate within the eval empty-source cluster; retire into ux-eval-empty-source-message-inconsistent-skins.md. Its 'suggest eval init' direction is the correct recovery and should survive the merge."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-eval/src/cli/lint.ts:113 and packages/agent-eval/src/source/open.ts:40 throw the same bare string, written raw via process.stderr.write (lint.ts:46, check.ts:36); probes 'npm run dev -- eval lint -C /tmp/empty-eval-probe' and 'eval check -C /tmp/empty-eval-probe' both printed unskinned 'Eval source \"/tmp/empty-eval-probe\" does not contain any first-level <id>/eval.yaml files.' with no next step"
---

# UX: eval lint/check empty source same bare message

## Summary

eval lint and eval check without evals: bare Eval source does not contain any first-level eval.yaml — no design-system; no next step.

## Evidence

Eval source "…" does not contain any first-level <id>/eval.yaml files.

## Why it matters

Empty eval UX incomplete.

## Suggested direction

Design-system; suggest eval init.

## Severity

Medium

## Area

Eval
