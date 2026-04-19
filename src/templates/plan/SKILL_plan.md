---
name: poe-code-plan
description: 'Draft a feature plan in five levels (what, UX, implementation, interfaces/tests, code). Triggers: plan this feature, draft a plan, feature plan, plan levels.'
---

## If The Request Is Empty

Ask: "What do you want to build?"

## Goal

Write `docs/plans/<name>.md` — five levels, each deeper than the last. `<name>` is kebab-case. If the session passed a `Plan directory:` line, use that instead.

## Chat vs document

Document = artifact. Chat = conversation. Per-level summaries, numbered decisions, and confirmation asks go in chat. Document holds plan content only: level headings, signatures, file lists, inline `- Open question:` notes.

## Ground rules

1. **Research first.** Check code, git log, docs, related plans before asking.
2. **Be concrete.** Real files, real functions, real types — no hand-waving.
3. **Summarize after each level — in chat.** Decisions made, what's open, what changed earlier.
4. **Numbered decisions when you need input — in chat.** One per line, options + your recommendation.

## The Five Levels

### 1. What we're building

The user's own words. No framing, no justification. Note explicit non-goals.

### 2. User-facing shape

Concrete end state. Pick the form:

- CLI: README section — commands, flags, example invocations, example output.
- UI: ASCII mockups.
- API / SDK: signatures, request/response, error shapes.
- Library: import + example usage.

### 3. Implementation details and technical decisions

- Architecture — where the code lives, what it touches.
- Edge cases — technical and product.
- Flags, env vars, config — and which are default-on.
- Open questions.

### 4. Interfaces and test plan

Contracts + validation, aimed at autonomous execution.

- Module-boundary types.
- Cross-package function signatures.
- Tests: unit, integration, e2e, manual QA — and what each proves.
- Rollout / migration if existing callers are affected.
- **Autonomy checklist** — what an agent needs to build and test without coming back.

### 5. Code plan

- Files to create + purpose.
- Files to change + what changes.
- Signatures for new/modified functions.
- Build order — what keeps the branch green.

## How to work through the document

- One level at a time. Pause for confirmation before the next.
- "just wing it" / "skip ahead" → draft the rest in one pass.
- Earlier level changes (e.g. UX sharpens the problem) → rewrite it.
- Open questions inline: `- Open question: ...`

## Output Format

```markdown
# <Feature name>

One-line summary.

## 1. What we're building

...

## 2. User-facing shape

...

## 3. Implementation details and technical decisions

...

## 4. Interfaces and test plan

...

## 5. Code plan

...
```

## Rules

- Plans go in the configured plan directory. Nowhere else.
- Use the level headings verbatim.
- Signatures and file lists only — no full implementations.
- One-liner request → stop after level 1 and confirm, unless told to wing it.

## After Writing

```text
Plan written to <plan_directory>/<name>.md

Next:
- Review level 2 with the user
- Convert level 5 into a pipeline plan when ready
```
