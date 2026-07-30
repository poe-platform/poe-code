---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# User-ordered harness plans

Let users reorder plans using filesystem modification time while retaining ready-first behavior.

## 1. What we're building

- Use each plan file's existing filesystem modification time (`mtime`) as its ordering value; newer plans appear first within the same readiness group.
- Keep `readiness: ready` as the primary ordering rule: every ready plan appears before every draft plan, regardless of `mtime`.
- Allow ready plans to be reordered freely among other ready plans, and draft plans to be reordered freely among other draft plans.
- Use readiness-then-`mtime` ordering consistently in the plan browser and in every agent harness that discovers runnable plans, including pipeline, gaslight, Ralph, experiment, and superintendent.
- Let a user move the selected plan up or down in the interactive plan browser using its existing reorder bindings, `Shift+ArrowUp` and `Shift+ArrowDown`.
- Persist an interactive move by changing only the selected file's `mtime`; do not rewrite file contents, rename files, or add a database, sidecar file, frontmatter attribute, or hidden ordering registry.
- Choose a timestamp between the selected plan's new neighbors when possible, so unaffected files retain their timestamps.
- Treat ordering as local filesystem state. Git clones, checkouts, copies, and tools that rewrite files may reset it.

### Non-goals

- Allowing a draft plan to be manually placed ahead of a ready plan.
- Reordering saved-for-later plans into the active plan group.
- Adding provider- or harness-specific ordering branches.
- Renaming plan files to encode their position.
- Renumbering or rewriting unaffected plan files during a move.

## 2. User-facing shape

The plan browser continues to show active ready plans first, followed by active draft plans. Within each readiness group, plans appear in user-controlled newest-`mtime`-first order.

```text
Plans

✓ Release authentication fix       Ready
✓ Improve retry reporting          Ready
  Add provider diagnostics         Draft
  Document local setup             Draft

⇧↑↓ reorder (within state)
```

With `Improve retry reporting` selected, pressing `Shift+ArrowUp` moves it above `Release authentication fix`, keeps it selected, and updates only its filesystem modification time. Pressing `Shift+ArrowDown` moves it back. The same interaction works among draft plans.

A plan cannot cross a readiness boundary through reordering. Pressing `Shift+ArrowDown` on the last ready plan or `Shift+ArrowUp` on the first draft plan restores the previous order and shows that plans can only be reordered within the same readiness group. The existing readiness action remains the way to move a plan between those groups.

After a successful move, the list remains in its new order without a cursor jump. The footer uses the shared explorer's existing `⇧↑↓ reorder (within state)` hint. No rank, position, or ordering field appears in the plan document or detail view.

All harness plan-selection lists use the same ready-first, newest-`mtime`-first order. Non-interactive automatic selection therefore considers ready plans in the order visible in the plan browser.

## 3. Implementation details and technical decisions

Implementation and local tests require no credentials, network services, environment variables, or external sample data. Terminal Pilot and memfs are already installed in the workspace. Publishing requires SSH push access to `git@github.com:poe-platform/poe-code.git` and authenticated GitHub workflow observation; the configured `gh` token must be valid or workflow status must be observed through another authenticated GitHub surface.

- `@poe-code/agent-harness-tools` owns the canonical discovery order: readiness descending, `mtime` descending, then display path ascending for deterministic equal-time ties.
- Shared discovery reads each file's `mtimeMs` while validating discovered paths, uses it as an internal sort value, and does not expose a new public plan metadata field.
- Pipeline preserves shared discovery order instead of replacing it with pathname order. Ralph, experiment, gaslight, and superintendent already preserve shared order.
- The shared explorer reorder effect identifies the moved row in addition to returning the optimistic ordered ID list. This prevents consumers from guessing which row in an adjacent swap initiated the move.
- The plan browser validates that the moved plan and its new neighbors share readiness and active/saved-for-later state.
- The plan browser calculates a new `mtime` above, below, or midway between the moved plan's new neighbors, preserves its access time when available, changes only that file with `utimes`, then refreshes from discovery.
- If adjacent timestamps leave no representable interval, the move fails and the explorer restores its previous rows. No unaffected files are rewritten to manufacture space.
- Reordering is disabled while filtering through the explorer's existing behavior.
- No configuration, frontmatter, database, migration, provider branch, or environment variable is added.

## 4. Interfaces and test plan

The plan document format and public CLI/SDK arguments do not change.

The internal explorer reorder context gains moved-row identity:

```ts
interface ReorderContext {
  movedId: string;
  refresh: () => Promise<void>;
  toast: (message: string, tone?: Tone) => void;
}
```

The plan-browser filesystem contract gains `utimes(...)`; its stat result may expose `atimeMs` so reordering can preserve access time.

### Automated tests

- `packages/agent-harness-tools/src/plans.test.ts`: ready-first ordering and newest-`mtime` ordering within ready and draft groups.
- `packages/pipeline/src/pipeline.test.ts`: pipeline prompts preserve shared ready-first, newest-`mtime` ordering.
- `packages/toolcraft-design/src/explorer/reducer.overhaul.test.ts`: reorder persistence identifies the moved row.
- `packages/toolcraft-design/src/terminal/input.test.ts`: standard terminal Shift+Arrow sequences retain the Shift modifier required by reordering.
- `packages/plan-browser/src/explorer-config.test.ts`: reorder is enabled, moving a ready plan changes only its timestamp, refreshed rows retain the new order, and readiness-boundary moves fail.
- Run focused tests, `npm run lint:types`, `npm run lint:eslint`, and the complete unit suite.

### Real-world test

1. Create an isolated temporary plan directory with at least three ready plans and two drafts whose timestamps are known and distinct.
2. Launch the built `poe-code plan` browser in a real PTY with Terminal Pilot.
3. Use arrow keys to select the middle ready plan, press `Shift+ArrowUp`, and capture the screen showing the new ready-plan order and retained cursor.
4. Compare `stat` results before and after; only the selected plan's `mtime` changes and no file content changes.
5. Move the ready plan down within the ready group and verify the order persists after closing and reopening the browser.
6. Attempt to move the last ready plan below the first draft; verify the list rolls back and displays the readiness-group error.
7. Run `npm run screenshot-poe-code -- plan` and inspect the rendered list, selection, readiness marks, and reorder footer hint.

### Must-work checklist

- [x] Ready plans always precede drafts; proof: shared discovery unit test and Terminal Pilot screen capture.
- [x] Ready plans reorder among themselves with `Shift+ArrowUp/Down`; proof: Terminal Pilot interaction and reopened browser.
- [x] Draft plans reorder among themselves; proof: plan-browser unit test and Terminal Pilot interaction.
- [x] A move changes only the selected file's `mtime`; proof: memfs unit test plus before/after `stat` and SHA-1 output.
- [x] A plan cannot cross readiness or saved-for-later boundaries; proof: unit test and Terminal Pilot error observation.
- [x] Pipeline, Ralph, experiment, gaslight, and superintendent preserve canonical shared order; proof: shared discovery, pipeline, and gaslight regression coverage plus consumer audit.
- [x] The CLI remains visually intact; proof: `npm run screenshot-poe-code -- plan` and screenshot inspection.
- [ ] The stable release succeeds; proof: successful GitHub release workflow after pushing `main`.

No data migration is required. Existing timestamps become the initial local order automatically.

## 5. Code plan

### Files to change

- `packages/agent-harness-tools/src/plans.ts`: sort discovered plans by readiness, modification time, and deterministic path tie-breaker.
- `packages/agent-harness-tools/src/plans.test.ts`: cover `mtime` ordering within readiness groups.
- `packages/pipeline/src/plan/discovery.ts`: preserve canonical shared discovery order.
- `packages/pipeline/src/pipeline.test.ts`: cover pipeline candidate order.
- `packages/toolcraft-design/src/explorer/events.ts`: include moved-row identity in reorder persistence effects.
- `packages/toolcraft-design/src/explorer/reducer.ts`: emit the selected row ID during reordering.
- `packages/toolcraft-design/src/explorer/runtime.ts`: pass moved-row identity to the persistence callback.
- `packages/toolcraft-design/src/explorer/state.ts`: expose moved-row identity through `ReorderContext`.
- `packages/toolcraft-design/src/explorer/reducer.overhaul.test.ts`: cover the moved-row contract.
- `packages/toolcraft-design/src/terminal/input.ts`: decode standard CSI Shift modifiers used by real terminal arrow-key input.
- `packages/toolcraft-design/src/terminal/input.test.ts`: cover Shift+ArrowUp and Shift+ArrowDown decoding.
- `packages/plan-browser/src/types.ts`: expose timestamp mutation and optional access time in the filesystem contract.
- `packages/plan-browser/src/discovery.ts`: wire Node timestamp operations into the default filesystem.
- `packages/plan-browser/src/explorer-config.ts`: configure reordering, validate group boundaries, calculate the selected file's new timestamp, persist it, and refresh.
- `packages/plan-browser/src/explorer-config.test.ts`: cover enabled reordering, selected-file-only timestamp mutation, stable refresh, and boundary rejection.
- `packages/agent-gaslight/src/daemon.test.ts`: make daemon execution order deterministic and prove newest ready plans run first.
- `docs/plans/user-ordered-harness-plans.md`: keep the implementation and verification contract current.

### Build order

1. Add failing shared-discovery, explorer-contract, and plan-browser behavior tests.
2. Add moved-row identity to the shared explorer contract.
3. Implement selected-file timestamp persistence in plan-browser.
4. Make shared harness discovery ordering explicit and remove pipeline's conflicting pathname sort.
5. Run focused tests and static checks.
6. Execute Terminal Pilot and screenshot QA, then check every must-work item with observed evidence.
7. Commit only scoped files, push `main`, and monitor the stable release through success.
