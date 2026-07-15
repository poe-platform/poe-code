---
severity: low
impact: none
comment: "Positive pattern; keep as canonical of this pair (cleaner framing) and retire ux-hooks-from-pi-unsupported-lists-supported.md into it. Its 'use for all agent allow-lists' suggestion is the actionable half and directly serves ux-unknown-agent-no-allow-list-or-suggestions.md and ux-gaslight-unknown-agent-says-service.md: the good pattern already exists here and only needs propagating."
---

# UX: hooks-from unknown agent lists supported agents (positive)

## Summary

Unsupported source hook agent lists Supported hook agents: claude-code, codex — good allow-list (still See logs).

## Evidence

```bash
$ poe-code spawn … --hooks-from notanagent
■  Error: Unsupported source hook agent "notanagent". Supported hook agents: claude-code, codex.
```

## Why it matters

Positive allow-list pattern to copy to unknown agent errors.

## Suggested direction

Keep; drop See logs; use for all agent allow-lists.

## Severity

Low

## Area

Hooks / positive pattern
