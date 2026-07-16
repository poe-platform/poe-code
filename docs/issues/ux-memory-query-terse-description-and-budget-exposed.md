---
severity: low
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/memory.ts:394-395 - .argument(\"<question>\", \"Question\") and .option(\"--budget <tokens>\", \"Token budget\") with no default or guidance"
comment: "Fair, correctly Low, and near-duplicate of ux-memory-explain-budget-token-internals.md on the --budget half - consolidate those. Its distinct half is the argument description ('question Question'), a genuine no-op that teaches nothing, and its suggested replacement is good. Pair with ux-memory-query-no-model-flag.md: the interface exposes --budget, which few users can reason about, and hides --model, which they actually need."
---

# UX: memory query argument description is a single word; --budget exposes token internals

## Summary

`memory query --help` has two issues:

1. **Argument description is just "Question"** — the `question` argument description reads `question    Question`. This restates the argument name and provides no useful context (what kind of question? what format? what constraints?).

2. **`--budget <tokens>` exposes implementation internals** — "Token budget" is a LLM infrastructure concept that most users should never need to tune. Exposing it as a first-class CLI flag without any guidance (what is a reasonable value? what happens if exceeded?) is confusing.

## Evidence

```
Arguments:
  question    Question

Options:
  --budget <tokens>   Token budget
  --agent <agent>     Agent override
```

## Why it matters

"Question" as a description teaches users nothing. A user new to the memory system does not know if they should write a one-word query or a full sentence question.

`--budget` without a default or range hint leaves users unable to reason about this flag.

## Suggested direction

- Argument: "Natural-language question to answer using stored memory pages"
- `--budget`: Either remove it from the user-facing interface (use an internal default) or add a note like "Max tokens for the answer (default: 4096)"

## Severity

Low

## Area

Memory / query / help / description quality
