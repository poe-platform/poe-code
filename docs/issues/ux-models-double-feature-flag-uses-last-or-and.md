---
severity: low-medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "Probe: '--feature tools --feature reasoning' => 45 rows == '--feature reasoning' (45); reversed order => 145 == '--feature tools' (145). Last-wins, not AND. src/cli/commands/models.ts:268 declares scalar '--feature <name>' (no collect/variadic); :324-325 reads single string; :391-392 applies one filter. Reported 44 = reasoning-only count (45 rows minus header), not a tools-AND-reasoning intersection. Sibling ux-models-feature-flag-not-repeatable.md is correct."
comment: "Directly contradicts ux-models-feature-flag-not-repeatable.md, which claims the second --feature replaces the first (last-wins); this measures 44/341 and infers AND. Both cannot be right, and the number here is real evidence while the sibling reasons from Commander's option shape. Resolve empirically before acting - if 44 is the tools-AND-reasoning intersection, AND is real. Either way the ask is agreed: document the semantics or accept comma-separated values."
---

# UX: models repeated --feature may AND filters

## Summary

models --feature tools --feature reasoning returns 44/341 — repeated --feature appears to AND (tools AND reasoning) rather than error or last-wins. Help does not document multi-feature behavior.

## Evidence

--feature tools --feature reasoning → 44/341 models

## Why it matters

Undocumented multi-flag semantics; users may expect OR.

## Suggested direction

Document AND semantics or accept comma-separated --feature tools,reasoning.

## Severity

Low–Medium

## Area

Models
