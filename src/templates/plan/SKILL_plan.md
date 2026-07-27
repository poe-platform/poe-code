---
name: poe-code-plan
description: "Draft a feature plan in five levels (what, UX, implementation, interfaces/tests, code). Triggers: plan this feature, draft a plan, feature plan, plan levels."
---

## If The Request Is Empty

Ask: "What do you want to build?"

## Goal

Write `docs/plans/<name>.md` as a generic plan doc — five levels, each deeper than the last. Start the document with canonical YAML frontmatter:

```yaml
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---
```

`<name>` is kebab-case. If the session passed a `Plan directory:` line, use that directory instead of `docs/plans`.

## Chat vs document

Document = artifact. Chat = conversation. The document holds plan content only: level headings, signatures, file lists, decisions you've made. **Everything that needs the user's input — per-level summaries, numbered decisions, open questions, confirmation asks — goes in chat, never in the document.** A plan doc is what you'd hand to an executor; questions to the human do not belong in it.

When the user resolves a question in chat, fold the answer into the relevant section of the doc. Do not record the resolution as a separate note.

## Ground rules

1. **Research first.** Check code, git log, docs, related plans before asking.
2. **Be concrete.** Real files, real functions, real types — no hand-waving.
3. **Summarize after each level — in chat.** Decisions made, what's open, what changed earlier.
4. **Numbered decisions when you need input — in chat.** One per line, options + your recommendation.
5. **No open questions in the doc.** If you don't know it yet, ask in chat. Don't seed `- Open question:` bullets, don't carve out an "Open questions" section.

## The Five Levels

### 1. What we're building

The user's own words. No framing, no justification. Note explicit non-goals.

### 2. User-facing shape

Concrete end state. This is the most important to get right. For example, practical usage.

- CLI: README section — commands, flags, example invocations, example output.
- UI: ASCII mockups.
- API / SDK: signatures, request/response, error shapes.
- Library: import + example usage.

### 3. Implementation details and technical decisions

- **Autonomy audit — do this first.** Everything the executor needs that the repo doesn't provide: env vars, credentials, network access, running services, sample data. Each item is confirmed available or gets a setup step in the plan; raise gaps in chat before drafting the rest of the level. A step that needs a human mid-run means the plan isn't ready.
- Architecture — where the code lives, what it touches.
- Edge cases — technical and product.
- Flags, env vars, config — and which are default-on.

### 4. Interfaces and test plan

Contracts + validation, aimed at autonomous execution.

- Module-boundary types.
- Cross-package function signatures.
- Tests: unit, integration, e2e, manual QA — and what each proves.
- **Real-world test** — exact commands run against the real thing, in order: the invocation, the expected output, and the observation that proves it worked. "Tests pass" is not a real-world test.
- **Must-work checklist** — `- [ ]` behaviors that must work when done, each paired with the command or observation that proves it. The executor checks a box only after running its proof.
- Rollout / migration if existing callers are affected.

### 5. Code plan

- Files to create + purpose.
- Files to change + what changes.
- Signatures for new/modified functions.
- Build order — what keeps the branch green.

## How to work through the document

- One level at a time. Pause for confirmation before the next.
- "just wing it" / "skip ahead" → draft the rest in one pass.
- Earlier level changes (e.g. UX sharpens the problem) → rewrite it.
- Open questions go in chat, not in the doc. Once resolved, fold the answer into the relevant section.

## Output Format

```markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

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
- Generic plan docs must start with `$schema`, `kind: plan`, and `version: 1`.
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
