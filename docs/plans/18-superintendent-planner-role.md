# Superintendent planner role

Add a planner role that runs before the builder and can invoke inspectors on demand — plus expand `extends:` to accept named bases and a list, ship a built-in `poe-code:planner` base, and add a `poe-code plan` CLI that wraps the planner role only.

## Scope addendum (after user's extends feedback)

This plan now also includes:

1. **Multi-form `extends:`** — extend `config-extends` to accept:
   - `extends: true` (today's behavior — discover base by convention)
   - `extends: <name-or-path>` (today: string is *stripped and ignored*; change to resolve as either a named base or a relative path)
   - `extends: [<a>, <b>, ...]` (new — list form, order defines merge precedence)
2. **Named base registry** — `poe-code:<name>` resolves to a built-in base shipped with the repo (e.g. `poe-code:planner`).
3. **Built-in `poe-code:planner` base** — ships a ready-to-use superintendent base whose only role is the planner.
4. **`poe-code plan` CLI** — thin wrapper over `superintendent.planner.run`; the default plan document uses `extends: poe-code:planner`.

Before I rewrite level 2 to include these, I need to confirm four decisions. They cascade into every downstream level.

1. **Where do the built-in bases live?**
   - (a) Inside `@poe-code/superintendent` at `packages/superintendent/bases/planner.md`, resolved from the installed package root.
   - (b) New package `@poe-code/superintendent-bases` as a dedicated registry.
   - Recommendation: **(a)** — one package, fewer moving parts, matches YAGNI. Only split out when there's a second consumer.

2. **String form — named vs path — how do we tell them apart?**
   - Options:
     - (a) Prefix-scoped: `poe-code:<name>` → registry lookup; anything else → relative path.
     - (b) Colon anywhere → registry lookup; otherwise path.
   - Recommendation: **(a)** — explicit namespace prefix avoids collisions with filenames that contain colons (rare but legal). Matches how npm / docker registries namespace names.

3. **List merge order** — `extends: [a, b]`:
   - (a) Left-to-right: `a` merges first, then `b`, then child — later entries win conflicts.
   - (b) Right-to-left: `b` merges first, then `a`, then child — earlier entries win conflicts.
   - Recommendation: **(a)** — matches CSS `@import`, TypeScript `extends` list semantics, and user intuition of "read top-to-bottom, each step refines."

4. **What does `poe-code plan` do, exactly?**
   - (a) **Create-then-run**: generates a new plan doc at `docs/plans/<name>.md` from a prompt, writing `extends: poe-code:planner`, then invokes the planner role once.
   - (b) **Run-only**: operates on an existing plan doc (arg is the path), runs planner only. Assumes the doc already has `extends: poe-code:planner` or a local planner config.
   - (c) **Both**, distinguished by whether the arg points to an existing file.
   - Recommendation: **(a)** — this is the "draft me a plan" ergonomic entry point. Power users still have `superintendent planner run <path>` for (b).

Answer these four by number and I'll rewrite levels 2–3 around them. Levels below these headings still reflect the *pre-extends* version of the plan and will be replaced.

---



## 1. What we're building

A new **planner** role inside the superintendent workflow. Current loop order is builder → inspectors → superintendent → owner. The planner slots in **first**, before the builder, and:

- Is executed once at the start of a round (or once per plan — TBD in level 3).
- Can call the same **inspectors** that the superintendent already has access to (the inspector pool is shared across roles, not owned by one role).
- Produces planning output that downstream roles (builder, superintendent) can reference via template variables.

Inspectors become a **shared pool** rather than something the superintendent/auto-run flow owns exclusively. Both the planner and the superintendent can invoke them on demand (likely via the existing `inspector.run` runtime tool pattern).

Scope carried in from the user's ask:
- Planner runs first.
- Planner can call inspectors.
- Inspectors are shared across roles.

Confirmed with user:
- Runs **once** at the start of the workflow.
- **Optional** — only runs when a `planner:` block exists in frontmatter. Existing docs without a planner block keep working unchanged.
- Planner can invoke inspectors via **both** auto-run (prompt-referenced inspectors run before the planner turn, matching today's builder behavior) **and** an on-demand `inspector.run` runtime tool. Runtime tool is expected to be the primary path.
- Responsibility: planner either creates the Task Board from scratch or does broader up-front planning before the builder starts.

## 2. User-facing shape

### Frontmatter — new optional `planner` block

```yaml
---
kind: superintendent
version: 1

mcp:
  browser:
    command: npx
    args: [playwright-mcp]

planner:                                      # new, optional
  agent: claude-code
  prompt: |
    You are the planner for {{plan.path}}.
    Before planning, consult {{inspectors.repo-scan}}.
    Write an actionable Task Board section into the document body.
  tools:
    mcp: [browser]

builder:
  agent: claude-code
  prompt: |
    Build the tasks listed in {{plan.path}}.
    Planner notes: {{planner.summary}}

inspectors:
  repo-scan:
    agent: claude-code
    prompt: |
      Inventory relevant files for {{plan.path}}.
  lint:
    agent: claude-code
    prompt: |
      Run lint and report issues.

superintendent:
  agent: claude-code
  prompt: |
    Review {{builder.summary}}. Original plan: {{planner.summary}}.

owner:
  agent: claude-code
  prompt: |
    Approve {{superintendent.summary}}.

status:
  state: in_progress
  round: 0
  review_turn: 0
---
# Feature name

## Task Board

<!-- may start empty; planner is expected to populate it -->
```

### Lifecycle — where the planner sits

Before any planner block exists, the loop is:

```
round 1: builder → auto-run inspectors → superintendent → (review ↔ owner)
round 2: builder → ...
```

With a `planner:` block defined, the first round becomes:

```
round 1: planner → builder → auto-run inspectors → superintendent → (review ↔ owner)
round 2: builder → ...   (no more planner)
```

The planner runs **exactly once**, immediately after the workflow starts and before the first builder turn. Subsequent rounds skip the planner entirely.

### New template variables

Exposed to downstream role prompts once the planner has run:

- `{{planner.summary}}` — planner's condensed summary.
- `{{planner.log}}` — full planner output (parity with `{{builder.log}}`).
- `{{inspectors.<name>}}` — already exists; the planner prompt can reference these and they auto-run before the planner turn.

If a downstream prompt references `{{planner.summary}}` but no `planner:` block is configured, validation fails at `superintendent validate` time — the author is asking for output that cannot be produced.

### CLI surface

New command parallel to existing `builder run` / `inspector run`:

```sh
npx tsx packages/superintendent/src/cli.ts planner run <doc>
```

- Runs only the planner role against the current document state.
- No-ops with a clear error if the document has no `planner:` block.
- Useful for iterating on the planner prompt without burning a full builder round.

Existing `superintendent run <doc>` automatically includes the planner step in round 1 when the block is present. No new flag needed to enable it — presence of the block is the switch.

### Runtime tool available to the planner

During the planner turn, the runtime injects:

- `inspector.run` — same shape already used by the superintendent today, letting the planner call any configured inspector on demand and receive its summary inline.

Auto-run (based on `{{inspectors.<name>}}` references in the planner prompt) still happens before the turn starts, same mechanism as the builder → inspectors handoff today.

### MCP surface

New tool to mirror the CLI:

- `superintendent.planner.run`

### Example output — terminal dashboard

```
[round 1]
  ▸ planner       running...
  ✓ planner       wrote 7 tasks to Task Board (2.1s)
  ▸ builder       running...
  ✓ builder       completed task 1/7
  ▸ inspector:lint ...
```

### Example output — `validate`

```
$ superintendent validate docs/plans/foo.md
ok: kind=superintendent, version=1
ok: planner block present (optional)
ok: inspectors referenced by planner: repo-scan (auto-run)
ok: task board found (0 items)
```

### Open questions carried forward

- Open question (level 3): If the planner writes a Task Board and the builder is the one that normally updates checkboxes, do we need any new write-conflict protection, or does the existing per-role document snapshot/restore cover it?
- Open question (level 3): Should `planner run` as a standalone CLI command allow re-running after round 1 (manual trigger), even though the loop itself only runs the planner once?

---

Level 2 summary:
- Added optional `planner:` frontmatter block; presence is the enable switch.
- Planner runs once at the top of round 1, before builder.
- Exposes `{{planner.summary}}` and `{{planner.log}}` template variables.
- CLI gets `planner run`; MCP gets `superintendent.planner.run`.
- Inspector pool is shared: planner uses auto-run (via prompt refs) + `inspector.run` runtime tool.
- Two open questions deferred to level 3.

## 3. Implementation details and technical decisions

### Architecture — where the code goes

Everything lives inside `packages/superintendent`. No new package. Touchpoints:

- `src/document/parse.ts` — extend `SuperintendentFrontmatter` with optional `planner?: AgentRoleConfig`, wire through `parseFrontmatter`.
- `src/runtime/templates.ts` — extend `TemplateContext` with `planner: { summary: string; log: string; log_path: string }`.
- `src/runtime/run-planner.ts` — **new file**. Direct mirror of `run-builder.ts`: resolves the planner prompt, invokes `spawn.autonomous`, returns `{ summary, log, log_path }`. Per CLAUDE.md "new provider" rule analog — one file, no branching boilerplate.
- `src/runtime/loop.ts` — add planner step at the top of the first round only (see "Lifecycle trigger" below).
- `src/runtime/agentic-tools.ts` — already exposes `createInspectorTool`; extend the injection site so planner turns also receive `inspector.run`.
- `src/commands/planner-group.ts` — **new file**. Mirror of `builder-group.ts`: defines `plannerRunCommand` + `plannerGroup`.
- `src/commands/index.ts` — register planner group.
- `src/cli.ts` / `src/mcp.ts` / `src/index.ts` — wire `plannerGroup` into CLI, MCP, and SDK exports.
- `README.md` — update (but only after user approval per CLAUDE.md).

### Lifecycle trigger — the "run once" guarantee

No new state machine state. The trigger is purely a check on the loop entry:

- Planner runs **iff** `doc.frontmatter.planner !== undefined` **and** `state.round === 0` **and** `state.state === "in_progress"`.
- After planner completes, the loop falls through into the existing round-start code path (which increments round 0 → 1 and invokes the builder).
- On a resumed workflow where `status.round > 0`, the planner block is ignored even if present — it already ran.
- Failure / abort during the planner turn is handled by the same document-snapshot/restore pattern used for the builder: snapshot the doc before the turn, restore on error, surface the error through `onPlannerFailed`.

This keeps `LoopState` untouched — the existing `round=0 → round=1` boundary is the fence.

### Inspector auto-run — generalize the filter

`filterAutoRunInspectors(doc)` currently scans `doc.frontmatter.superintendent.prompt` hard-coded. Extract to `filterAutoRunInspectorsForPrompt(doc, prompt)` that takes an arbitrary prompt string. The loop then calls it twice:

- Before planner turn (if planner configured): pass `doc.frontmatter.planner.prompt`.
- Before superintendent turn: pass `doc.frontmatter.superintendent.prompt` (existing behavior, unchanged outcome).

Inspector reruns inside one round work as today — if both planner and superintendent reference the same inspector, it runs once for each consumer; the second run overwrites the template value in `context.inspectors[name]`. That's acceptable; agents that don't want re-execution can use the `inspector.run` runtime tool to reuse prior output.

### Template variables

Add to `TemplateContext`:

```
planner: { summary: string; log: string; log_path: string }
```

- `{{planner.summary}}` / `{{planner.log}}` resolve after the planner turn completes and are available to every downstream role in round 1 and beyond.
- Before the planner runs (or when no planner configured), these references leave the token literally in the prompt — consistent with how `{{builder.summary}}` behaves before the first builder turn. That is the existing convention; don't change it.
- `validate` command gets a new rule: if any role prompt references `{{planner.*}}` and no `planner:` block is configured, emit a validation error. Mirrors the existing check for `{{inspectors.<name>}}` referring to undefined inspectors.

### Runtime tool injection

`inspector.run` is currently injected for superintendent turns inside `mcp.ts`-style server setup. The planner turn must receive the same tool with the full inspector list. Implementation: wrap the planner spawn the same way the superintendent spawn is wrapped — the existing `createInspectorTool(inspectorNames)` is reused verbatim. No new tool definition.

`workflow_transition` is **not** injected for the planner — the planner has no authority to transition workflow state; it only produces planning output.

### Config / flags / env vars

- No new env vars.
- No new CLI flags on `superintendent run` — planner presence is the switch.
- `max_rounds` unchanged. Planner is outside the round counter.
- No new default value in frontmatter; the `planner` field is simply absent-or-present.

### Edge cases

Technical:
- **Resume after planner already ran**: guarded by the `state.round === 0` check.
- **Planner crash mid-turn**: snapshot/restore of document body, then re-throw with `onPlannerFailed` callback fired. No partial Task Board writes survive.
- **Abort signal during planner**: matches builder behavior — rollback round status, finish loop with `stopReason: "aborted"`.
- **Planner prompt references an inspector that doesn't exist**: caught by `validate` (reuses existing inspector-reference check).
- **Planner writes nothing to Task Board**: loop continues — builder runs on an empty board. Not an error; empty boards are legal in existing docs too.
- **Concurrent planner + inspector invocation**: planner turn is single-threaded; `inspector.run` runtime tool calls are sequential within the planner turn.

Product:
- **Planner with no builder body updates**: fine; planner is authorized to write to doc body (same as builder is today via snapshot/restore).
- **User runs `planner run` standalone on a doc whose `status.round > 0`**: the CLI command runs anyway (manual override), since standalone commands don't check loop round. This matches how `builder run` works today.
- **User runs `planner run` on a doc with no `planner:` block**: error: `planner role is not configured in <path>`.

### Open questions — resolved

- **Write-conflict protection with builder also updating Task Board**: no new mechanism needed — the existing per-role document snapshot/restore pattern handles it. Planner and builder each see a fresh read of the doc.
- **Standalone `planner run` after round 1**: allowed. The loop skips planner after round 1, but the standalone command always runs the role once against the current doc state — useful for iterating on the prompt. Consistent with `builder run` / `inspector run`.

### Open questions — deferred to level 4

- Open question: should the planner receive its own log file bucket (`plan.log/planner/`) or share the top-level `logDir`? Leaning share, keyed by role name (`planner` vs `builder`), matching today's naming from `makeRunLogFileName(role)`.

---

Level 3 summary:
- New file: `run-planner.ts`; new command group file: `planner-group.ts`. No new state, no new env vars.
- Trigger is `planner != null && round === 0 && state === in_progress`. No `LoopState` changes.
- `filterAutoRunInspectors` generalized to accept any prompt string; reused for planner.
- `TemplateContext` gains `planner`; `validate` gains a reference check.
- `inspector.run` runtime tool injected for planner turns; `workflow_transition` is not.

Happy with the technical shape? Reply and I'll draft level 4 (interfaces + test plan).
