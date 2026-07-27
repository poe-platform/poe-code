---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: ready
---

# Stable plan browser actions

Make destructive actions keyboard-accessible and accurate, and keep the selected plan stationary when its readiness changes.

## 1. What we're building

- Add `Ctrl+X` as the keyboard shortcut for deleting the selected plan; do not require a physical Delete key.
- Keep the existing destructive-action confirmation before deleting a plan.
- When a plan is toggled between `draft` and `ready`, keep it at the same position in the visible plan list and preserve the cursor on that plan.
- Do not promote a newly ready plan to the top of the list during the active browsing session.
- Preserve existing plan discovery and ordering when the browser is opened or plans are otherwise reloaded from source.
- Make destructive confirmation controls describe the action being confirmed: archiving shows `Archive`, while deleting shows `Delete`.

### Non-goals

- Changing the readiness states or their persisted frontmatter representation.
- Removing or reassigning `Ctrl+D` half-page navigation.
- Changing archive behavior.

## 2. User-facing shape

### Delete shortcut

With a plan selected, `Ctrl+X` opens the existing destructive confirmation rather than deleting immediately:

```text
Confirm destructive action
Delete feature.md?

[ Delete ]    Cancel
```

Confirming deletes the selected plan and refreshes the browser. Canceling leaves the plan and selection unchanged. `Ctrl+D` continues to move down half a page.

### Stable readiness toggle

Pressing `Ctrl+R` toggles the selected plan between `draft` and `ready`. Its readiness marker and persisted frontmatter update, but its row stays at the same visible position and remains selected. Other rows do not move during this refresh.

The next newly opened browser session may apply the normal discovery ordering, including ready-first ordering.

### Accurate destructive confirmations

Archiving presents archive-specific copy and controls:

```text
Confirm destructive action
Archive feature.md?

[ Archive ]    Cancel
```

Deleting presents delete-specific copy and controls. The confirmation title may remain generic, but the question and primary button must use the selected action's label.

## 3. Implementation details and technical decisions

No credentials, network services, environment variables, or sample data are required to implement or test this change.

- `@poe-code/plan-browser` assigns the delete action the `x` accelerator, which the explorer exposes as `Ctrl+X`.
- The readiness handler marks only its next refresh as order-preserving. That refresh matches rediscovered entries back into the current session order by absolute path, so updated metadata is retained without moving rows.
- Normal initial discovery and unrelated refreshes continue to use discovery's ready-first, newest-first ordering.
- The shared explorer confirmation derives both the question verb and primary button label from the destructive action's label. This fixes archive confirmation generically without provider- or action-specific branching.
- Confirmation remains mandatory for archive and delete actions.
- Duplicate entries with the same absolute path retain occurrence order during the readiness refresh.

## 4. Interfaces and test plan

No public SDK, CLI arguments, configuration, or environment-variable interfaces change.

The existing `Action<R>` contract remains unchanged. A destructive action's `label` now supplies the confirmation verb and primary-button text instead of all destructive actions using `Delete`.

### Automated tests

- `packages/plan-browser/src/explorer-config.test.ts` proves the delete action exposes accelerator `x` and a readiness refresh keeps the selected plan in its original row while updating the ready marker.
- `packages/toolcraft-design/src/explorer/reducer.test.ts` proves a destructive action labeled `Remove` produces matching confirmation question and button text.
- Run the complete tests and lint/type checks for `toolcraft-design` and `plan-browser` through the repository test commands.

### Real-world test

1. Run `npm run dev -- plan` in an interactive terminal with at least two plans.
2. Select a draft plan below another row and press `Ctrl+R`; observe its `✓` marker changes while the row and cursor stay in place.
3. Press `Ctrl+X`; observe `Delete <name>?` and `[ Delete ]`, cancel, and verify the file remains.
4. Choose Archive from the action palette; observe `Archive <name>?` and `[ Archive ]`, cancel, and verify the file remains active.
5. Capture `npm run screenshot-poe-code -- plan` and inspect the resulting screenshots for intact modal borders, labels, footer hints, and selection state.

### Must-work checklist

- [x] `Ctrl+X` targets Delete and opens confirmation, proven by the explorer configuration test and interactive invocation.
- [x] Canceling Delete leaves the file intact, proven by interactive observation.
- [x] `Ctrl+R` changes readiness without changing row position, proven by the plan-browser unit test and interactive observation.
- [x] Archive renders an Archive confirmation button, proven by the reducer test and screenshot inspection.
- [x] Delete renders a Delete confirmation button, proven by existing modal rendering coverage and screenshot inspection.
- [x] `Ctrl+D` still performs half-page-down navigation, proven by the existing explorer reducer navigation test.

No migration or rollout steps are required.

## 5. Code plan

### Files to change

- `packages/plan-browser/src/explorer-config.ts`: bind Delete to `Ctrl+X`; preserve current plan ordering for the readiness-triggered refresh.
- `packages/plan-browser/src/explorer-config.test.ts`: cover the delete accelerator and stable readiness order.
- `packages/toolcraft-design/src/explorer/reducer.ts`: derive destructive confirmation text from the selected action label.
- `packages/toolcraft-design/src/explorer/reducer.test.ts`: cover action-specific destructive confirmation text.
- `docs/plans/plan-browser-stable-actions.md`: record the approved behavior, implementation, and verification plan.

### Modified internal signatures

```ts
function preservePlanOrder(current: PlanEntry[], refreshed: PlanEntry[]): PlanEntry[];
```

### Build order

1. Add failing behavioral tests for stable readiness, `Ctrl+X`, and action-specific confirmation labels.
2. Implement order preservation in plan-browser and confirmation-label derivation in the shared explorer.
3. Run focused tests, package-wide tests, lint/type checks, and screenshot QA.
4. Commit only the five scoped files, push `main`, and monitor release workflows through successful publication.
