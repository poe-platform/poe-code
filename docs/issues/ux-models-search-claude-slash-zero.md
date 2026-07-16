---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:387-388 searches m.id or m.owned_by separately, while models.ts:466,492,522 display the label as `${owned_by.toLowerCase()}/${id}`; no searched string ever contains '/', so any slash term matches 0."
comment: "Same root as the namespaced-id cluster seen through --search rather than --model: substring matching runs against a string where the slash does not appear as users expect, so pasting a namespace prefix returns zero. Consolidate with ux-models-search-quoted-catalog-display-name-fails.md, the sharper version, and treat both as evidence that the id shown, the id searched and the id stored are three different strings."
---

# UX: models --search "claude/" returns 0 (namespace slash footgun)

## Summary

models --search "claude/" → 0/341 while claude models exist — slash confuses substring match for namespaced ids.

## Evidence

--search "claude/" → 0 models; --search claude works.

## Why it matters

Users pasting prefixes with slash get empty.

## Suggested direction

Strip trailing slash; or match on provider/id parts.

## Severity

Medium

## Area

Models
