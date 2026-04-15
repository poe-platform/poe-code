# Experiment Doc `extends` — Frontmatter Inheritance

## Problem

When a target repo wants to tweak one field (e.g. `agent`) of an experiment doc, they must copy the entire doc. There's no way to say "use the defaults but change X."

## Solution

Experiment docs support an `extends` field in frontmatter that references a base template by name. The extending doc inherits all frontmatter fields and body from the base, overriding only what it specifies.

```yaml
# .poe-code/experiments/my-review.md
---
extends: review
agent: aider:openrouter/deepseek-v3
---
```

## Base Template Resolution

Search paths in order:

1. **Project:** `<cwd>/.poe-code/experiments/bases/<name>.md`
2. **Global:** `<homeDir>/.poe-code/experiments/bases/<name>.md`

First match wins. If no file is found, throw an error listing searched paths.

## Merge Semantics

| Field | Behavior |
|-------|----------|
| Scalars (`agent`, `maxExperiments`, `metricTimeout`) | Child wins |
| `metric` (array or single) | Child replaces entirely |
| `baseline` | Child wins; `null` resets to re-measure |
| Body (markdown below frontmatter) | Child replaces if non-empty, otherwise inherits |

Merge is a shallow spread: `{ ...base.frontmatter, ...child.frontmatter }`. The `extends` key is stripped from the final result.

## Chaining

`extends` can chain: A extends B, B extends C. Resolution is recursive, bottom-up (C resolved first, then B merges on top, then A merges on top). Depth limit of 5 prevents cycles or accidental deep chains.

## Integration Point

Single change in `loop.ts`: the `readDoc()` inner function calls `resolveExtends()` after `parseExperimentFrontmatter()`. Everything downstream works unchanged because the resolved output has the same shape.

## Body as Prompt

The markdown body below frontmatter is internally treated as the prompt content. When a child extends a base, the body/prompt follows the same override rule: non-empty child body replaces base body, empty child body inherits.

## Examples

### Base template

```yaml
# .poe-code/experiments/bases/review.md
---
agent: claude-code
metric:
  name: lint-score
  script: npm run lint:score
  direction: maximize
---
Review the code for quality and correctness.
Focus on error handling, edge cases, and test coverage.
```

### Override agent only

```yaml
# .poe-code/experiments/fast-review.md
---
extends: review
agent: claude-code:anthropic/claude-haiku-4-5
---
```

Result: uses haiku agent, inherits lint-score metric and review body.

### Override agent and body

```yaml
# .poe-code/experiments/security-review.md
---
extends: review
agent: claude-code:anthropic/claude-sonnet-4-5
---
Focus specifically on security vulnerabilities: injection, auth bypass, data exposure.
```

Result: uses sonnet agent, inherits lint-score metric, uses custom security-focused body.

### Chaining

```yaml
# bases/default.md — agent: claude-code, metric: test-pass
# bases/review.md  — extends: default, metric: lint-score (overrides metric, inherits agent)
# my-review.md     — extends: review, agent: aider (overrides agent, inherits metric + body from review, which inherited from default)
```
