---
status:
  state: completed
  iteration: 5
---
# Plan: `config-extends` Markdown `yield`

## Problem

Today `@poe-code/config-extends` treats markdown bodies as a single `prompt` field with one rule: the first non-empty prompt wins.

That works for full replacement, but not for layout-style extension. If a built-in prompt wants to provide a stable wrapper and let an extending doc insert custom instructions into the middle, the child has to copy the whole prompt body.

That recreates the stale-copy problem `extends` was meant to solve.

## Decision

Keep **Mustache** as the only prompt renderer.

Add `yield` as a **pre-render composition step** in `config-extends`, not as:

- Handlebars,
- Mustache inheritance syntax,
- or a normal Mustache variable.

The output of `config-extends` should still be a single final prompt template string that downstream consumers render with Mustache exactly once.

## Why this approach

Treating `yield` as a normal Mustache variable would insert raw text, but any nested Mustache tags inside the yielded content would not be rendered on the same pass.

Example:

Base template:

```md
Read {{url}}

{{yield}}
```

If `yield` were passed as the variable value:

```md
Focus on {{repo}} and tests.
```

the inserted `{{repo}}` would remain literal unless we introduced a second render pass. We do not want multi-pass templating.

So the correct shape is:

1. compose prompt strings first,
2. produce one final template string,
3. then render that template once with Mustache.

## Goal

Add an explicit `yield` mechanism for prompt composition so extending markdown can:

- keep upstream prompt updates,
- inject custom content at a specific spot,
- stay compatible with existing `extends: true` behavior,
- preserve existing Mustache variables like `{{url}}`,
- avoid changing non-prompt merge semantics.

## Non-goals

- No Handlebars adoption.
- No Mustache inheritance / parent-block syntax.
- No named slots / `content_for` yet.
- No arbitrary markdown AST merge.
- No frontmatter merge changes.
- No README changes in this planning step.

## Proposed Syntax

Reserve the exact token:

```text
{{yield}}
```

Important: this token is handled by `config-extends` during prompt composition, **before** Mustache rendering.

It is not exposed to consumers as a runtime Mustache variable.

## Examples

### 1. Base layout wraps child body

Base:

```md
---
agent: codex
---
Read {{url}} and make the smallest safe change.

{{yield}}

Always explain what changed.
```

Child:

```md
---
extends: true
---
Focus on test coverage and edge cases in {{repo}}.
```

Composed prompt before Mustache render:

```md
Read {{url}} and make the smallest safe change.

Focus on test coverage and edge cases in {{repo}}.

Always explain what changed.
```

Then Mustache renders `{{url}}` and `{{repo}}` once.

### 2. Child layout wraps inherited prompt

Base:

```md
---
---
Fix the issue described in {{url}}.
```

Child:

```md
---
extends: true
---
Repository policy:
- keep changes small
- avoid unrelated refactors

{{yield}}
```

Composed prompt:

```md
Repository policy:
- keep changes small
- avoid unrelated refactors

Fix the issue described in {{url}}.
```

### 3. Chained layouts

If A extends B extends C, composition is applied pairwise from higher to lower precedence, so wrappers can nest and the final output is still one Mustache template string.

## Semantics

### Composition rule

For adjacent prompt layers `high` and `low`:

1. Empty `high` falls through to `low`.
2. If `high` contains `{{yield}}`, replace that token with `low` (or empty string when missing).
3. Otherwise, if `low` contains `{{yield}}`, replace that token with `high`.
4. Otherwise, keep `high` unchanged.

That preserves current replacement behavior unless a layer explicitly opts into composition with `{{yield}}`.

### Empty child body

If the extending doc has no body, `{{yield}}` resolves to an empty string. That keeps layout prompts usable even when the child only overrides frontmatter.

### Unsupported / v1 constraints

To keep the first version simple and deterministic:

- support **one** `{{yield}}` token per prompt string,
- throw a clear error when a prompt contains more than one,
- throw if a final resolved prompt still contains an unresolved `{{yield}}`.

If we later need multiple insertion points, that should be a separate named-slot design.

## Implementation shape

### 1. Keep non-prompt merge logic unchanged

`merge.ts` already handles objects, arrays, scalars, and empty prompt fallback correctly. We should not teach generic deep-merge about layout composition.

Instead, implement prompt composition in `resolve.ts`, where we already know which layer is the document and which layers are extends bases.

### 2. Compose document/base prompts before generic merge

Add a helper such as `composePromptChain()` that receives the ordered prompt layers for:

- document,
- resolved base 1,
- resolved base 2,
- ...

It returns a single composed prompt string.

Then:

- inject that composed prompt back into the document data,
- strip `prompt` from resolved base data layers before passing them to `mergeLayers()`.

This preserves all existing precedence rules for:

- data layers before the document (explicit overrides still win),
- data layers after the document (fallbacks still fill gaps),
- all non-prompt keys.

### 3. Keep format handling unified

Although the main use case is markdown bodies, composition should operate on the normalized `prompt` field. That means markdown, YAML, and JSON docs all get the same behavior when they set `prompt` to a string containing `{{yield}}`.

### 4. Rendering responsibility stays with consumers

`config-extends` should only return the composed prompt template.

Consumers like github-workflows keep doing what they already do today:

- call `resolve(...)`,
- receive `resolved.data.prompt`,
- render that prompt with Mustache once.

No second render pass. No new renderer abstraction.

### 5. Source tracking

Keep the current API shape.

For v1, `sources.prompt` should continue to point at the highest-precedence prompt layer participating in the resolved prompt. That is slightly lossy for wrapped prompts, but it avoids API churn and is enough for current consumers.

If richer provenance becomes necessary later, we can add separate metadata then.

## Test plan

### `packages/config-extends`

Add focused unit tests first:

- base markdown with `{{yield}}` wraps child markdown body,
- child markdown with `{{yield}}` wraps inherited base prompt,
- chained bases nest correctly,
- child with empty body removes the placeholder cleanly,
- prompt without `{{yield}}` keeps current replacement semantics,
- data layer before document can still override the composed prompt,
- more than one `{{yield}}` throws,
- YAML/JSON `prompt` fields also compose if we keep the normalized-field behavior.

### Consumer regression coverage

Add at least one integration-style test where the feature matters:

- `packages/github-workflows/src/discover.test.ts` or `github-workflows-utils.test.ts` proving the composed prompt still renders Mustache variables after composition,
- optionally `packages/ralph/src/ralph.test.ts` for a Ralph base template wrapping child instructions.

## Rollout steps

1. Add prompt-composition helper and tests in `@poe-code/config-extends`.
2. Update `resolve.ts` to compose prompt chains before generic merge.
3. Add consumer regression tests in github-workflows (and Ralph if needed).
4. If we want user-facing docs afterward, ask for permission before updating READMEs.

## Why this shape

This keeps the feature small and consistent:

- Mustache remains the renderer,
- one new reserved composition token,
- no Handlebars,
- no multi-pass templating,
- no new frontmatter keys,
- no AST merge,
- no change to normal field precedence,
- fully backward compatible unless a prompt explicitly opts in with `{{yield}}`.
