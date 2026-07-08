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
