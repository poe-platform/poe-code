---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- eval run --agnt prints 'Unknown option \"--agnt\". Did you mean: --agent?' then 'Run npm run dev -- eval run --help for usage.'; footer text from src/utils/execution-context.ts:196 formatCliUsageCommand development branch; suggestions from packages/toolcraft/src/cli.ts formatSuggestionMessage"
comment: "Genuinely useful because of the contrast it captures in one line: '--agnt' produces a correct 'Did you mean --agent?' and then a recovery footer naming npm run dev - so the same error panel gets suggestions right and identity wrong. That is the cleanest proof the two problems are independent: the suggester works, the binary name does not. Retire the identity half into the root cause and cite the suggestion half from ux-toolcraft-has-suggestions-poe-code-root-does-not.md as evidence that option-level suggestions already ship."
---

# UX: Toolcraft Did you mean still footers npm run dev

## Summary

Good option suggestions; wrong recovery footer.

## Evidence

eval run --agnt → Did you mean --agent? Run npm run dev….

## Why it matters

Suggestion good; command wrong.

## Suggested direction

Keep suggest; fix footer.

## Severity

**High**

## Area

Help / identity
