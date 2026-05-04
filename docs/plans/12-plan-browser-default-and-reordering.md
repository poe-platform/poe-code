---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Plan browser as default and priority reordering

Make `poe-code` (no args) launch the plan browser, and let users reorder plans by priority with shift+arrow.

## 1. What we're building

- The root command should run the manager (the plan browser, `poe-code plan browse`).
- Add priority ordering with shift+arrow keys in the browser.

## 2. User-facing shape

### Root command

`poe-code` with no arguments launches the plan browser. Equivalent to `poe-code plan browse`.

```text
$ poe-code
┌  plan browser
│
◆  Select a plan
│  ❯ 01-agent-human-in-loop                       Plan
│    02-ai-sdk-provider-poe-integration            Plan
│    03-consolidate-planning-docs                  Plan
│    04-http-mcp-production-readiness              Plan
│    05-human-in-loop-approval-windows             Plan
│    ...
│
│  ↑↓ navigate · ⇧↑ ⇧↓ reorder · enter open · q quit
└
```

`poe-code --help` still prints help. On non-TTY stdin (`poe-code | cat`, CI without a tty), the browser cannot run and the command prints help instead. `--yes` has no effect on the browser — the browser is interactive only.

### Plan list ordering

The list shows plans in the order returned by the underlying task-list (priority order). For the markdown-dir backend that's the prefix order on disk (`01-…` first, `21-…` last). Replaces the current mtime-based sort.

### Reorder with shift+arrow

While a plan is highlighted in the list:

- `Shift+↑` — move the highlighted plan up by one position.
- `Shift+↓` — move the highlighted plan down by one position.

The move is committed immediately via the task-list's `move()` operation. For the markdown-dir backend that means the file is renamed (prefixes are repacked) before the list re-renders. The highlight follows the moved plan so the user can keep nudging.

If a move would be a no-op (already at top / bottom), the keypress is ignored.

### Browser actions remain

After picking a plan with `Enter`, the existing flow is unchanged: render preview → choose Edit / Archive / Delete / Back ([packages/plan-browser/src/browser.ts:79-130](packages/plan-browser/src/browser.ts#L79-L130)). Archive continues to call the task-list's `archive` event, which already repacks remaining prefixes ([commit 5caa5f1d](docs/plans/archive/zharness-plans-via-task-list.md)).

### README addition

Add a short section under the top-level "Quick start" of the project README:

```md
### Plan browser

Run `poe-code` with no arguments to open the plan browser. From there you can:

- Browse plans across kinds (plan, pipeline, experiment, ralph, superintendent).
- Reorder plans by priority with `Shift+↑` / `Shift+↓`.
- Edit, archive, or delete the selected plan.

The browser is also available as `poe-code plan browse`.
```

## 3. Implementation details and technical decisions

_TBD._

## 4. Interfaces and test plan

_TBD._

## 5. Code plan

_TBD._
