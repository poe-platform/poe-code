---
name: poe-code-plan
description: 'Draft a plan for a product feature by going deeper through five altitudes: problem, user-facing shape, implementation details, interfaces and test plan, and code plan. Triggers on: plan this feature, draft a plan, product plan, feature plan, plan levels.'
---

## If The Request Is Empty

Ask the user one sentence: "What do you want to plan?"

## Goal

Write a planning document at `docs/plans/<name>.md` that walks through five altitudes, going deeper as the plan becomes more concrete.

Use `<name>` as a short kebab-case summary of the feature.

The default plan directory is `docs/plans`. If the CLI provided an explicit `Plan directory:` line for this session, use that directory instead — it reflects the user's `plan.plan_directory` config.

## The Five Altitudes

### 1. Problem

State the problem the feature solves, not the solution. Answer:

- What hurts today, and for whom?
- What evidence says this is worth solving now?
- What is explicitly out of scope?

### 2. User-facing shape

Describe concretely how users will encounter the feature at the end state. Pick the form that matches the feature:

- CLI: draft the README section — commands, flags, example invocations, example output.
- UI: sketch the screens. ASCII mockups are fine.
- API / SDK: write the function signatures, request/response payloads, error shapes.
- Library: write the import and the example usage.

The goal is a concrete end state someone could use to critique the design without reading any code.

### 3. Implementation details and technical decisions

Once the shape is clear, work out how it gets built:

- Architecture: where does the new code live, what existing pieces does it touch?
- Edge cases — technical (timeouts, concurrency, failure modes) and product (empty states, permission boundaries, partial data).
- Flags, env vars, config knobs — list them and say which are on by default.
- Open questions — write them down even if you cannot answer them yet.

### 4. Interfaces and test plan

Bridge the decisions into concrete contracts and a validation strategy:

- Data shapes and types at the module boundaries.
- Function signatures that cross package / layer boundaries.
- Test strategy: which unit tests, which integration tests, which manual QA steps, and what each proves.
- Rollout / migration steps if this touches existing callers.

### 5. Code plan

Draft the actual work:

- Files to create and their purpose.
- Files to change and what changes.
- Function signatures for the new or modified functions.
- Ordering — what to build first so the branch stays green.

## How to work through the document

- Walk the altitudes in order, one at a time. Finish altitude N before drafting altitude N+1.
- After each altitude, pause and confirm with the user before moving to the next one.
- If the user says something like "just wing it", "do all at once", or "skip ahead", drop the per-altitude pause and draft the rest in one pass.
- If an earlier altitude changes (e.g. the problem sharpens after drafting the UX), go back and rewrite it before moving on.
- Keep each altitude short. The goal is a plan someone can read end-to-end, not an encyclopedia.
- Capture open questions inline inside whichever altitude they belong to, prefixed with `- Open question:`.

## Output Format

```markdown
# <Feature name>

Short one-line summary.

## 1. Problem

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

- Plans live in the configured plan directory (`docs/plans/<name>.md`). Do not write them elsewhere.
- Use the altitude headings exactly as shown so the plan is skimmable.
- Do not write code in the plan. Function signatures and file lists are fine; full implementations belong in the follow-up PR.
- If the user's initial request only contains a problem, stop after altitude 1 and confirm the problem statement before moving on — unless they asked to wing it.

## After Writing

Report the path to the new plan and suggest the next step:

```text
Plan written to <plan_directory>/<name>.md

Next:
- Review altitude 2 (user-facing shape) with the user
- Convert the code plan (altitude 5) into a pipeline plan when ready
```
