---
severity: high
impact: usability
comment: "Real and worth keeping alongside the codex-source twin: help lists transform as a valid --hooks-strategy choice, users pick it, and it fails with 'only codex-hook targets can be written' - informative but too late, and wearing system chrome. Consolidate with ux-hooks-from-codex-to-claude-transform-unsupported.md into one capability-matrix issue: both are the same defect from the target and source sides, where choice lists are not filtered by what is implemented."
---

# UX: hooks-strategy transform unsupported message is good but system chrome

## Summary

Transforming hooks to claude-code is not supported yet is informative but still Error + See logs; help lists transform as a valid choice so users select it and fail.

## Evidence

```bash
$ poe-code spawn … --hooks-strategy transform --hooks-from claude-code
■  Error: Transforming hooks to "claude-code" is not supported yet; only codex-hook targets can be written
●  See logs …
```
--hooks-strategy choices include transform.

## Why it matters

Help advertises unsupported combinations; failure looks like crash.

## Suggested direction

Filter choices by capability; ValidationError without logs; document supported matrix.

## Severity

**High**

## Area

Hooks / spawn
