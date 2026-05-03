---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/feature.schema.json
kind: feature
version: 1
status:
  state: draft
---

# task-list: ordering + gh-issues backend

Two adjacent features for [packages/task-list/](packages/task-list/):

1. Explicit task ordering — backlog/Kanban-style "what's next" semantics with a small, pluggable API.
2. A third backend: `gh-issues`, backed by a GitHub repo + GitHub Project (v2). Same `TaskList` shape, real issues underneath.

The README currently calls these "backends"; the user calls them "providers". This plan keeps the codebase term **backend** and notes the alias once. No rename.

## 1. What we're building

### 1a. Ordering

Today, `Tasks.all()` returns tasks sorted alphabetically by `qualifiedId` ([backends/utils.ts:23-25](packages/task-list/src/backends/utils.ts#L23-L25)). There is no notion of "first task to work on next" — the consumer has to impose its own order. We add an **opt-in, per-list** order with a small API that both backends implement uniformly.

Out of scope:

- Cross-list global ordering. Order is scoped to one list.
- Sub-tasks, dependency DAGs, due-date sort. (Use `metadata` + your own sort if you need it.)
- Re-deriving order from state. State and order are independent axes.

### 1b. `gh-issues` backend

A new backend selected by `type: "gh-issues"` that maps the `TaskList`/`Tasks`/`Task` shapes onto a single GitHub repo + a single GitHub Project (v2). Lists map to the project's **Status field values** (because that's where ordering and "what's next" already live in GH Projects). State machine maps onto issue open/closed + project status.

Out of scope for v1:

- Multi-repo or multi-project per backend instance. One repo + one project per `openTaskList` call.
- Creating the repo or project. They must already exist; we only read/write items inside them.
- GitHub Apps. v1 uses a token (env var) read from a single source.
- Webhooks / live sync. All reads hit the API on demand.

## 2. Terminology note

`@poe-code/task-list` ships with two backends today (`markdown-dir`, `yaml-file`). `gh-issues` is a third **backend**, selected by the same `type` discriminant in `OpenTaskListOptions`. We won't introduce the word "provider" in this package — it already means something else across poe-code (auth providers in `src/providers/`).

## 3. Ordering — API surface

### 3a. Methods on `Tasks`

Order is the only view. `all()` and `get()` keep their names; their **default return order changes** to priority order, and `all()` accepts an optional `order` discriminator for callers that need something else. Two new mutators:

```ts
interface ListFilter {
  state?: string;
  includeArchived?: boolean;
  order?: "priority" | "alphabetical" | "created";  // default: "priority"
}

interface Tasks {
  // ...existing...
  all(filter?: ListFilter): Promise<Task[]>;        // signature unchanged, default sort changed

  /** Move a task to a position relative to another task or to an end. */
  move(id: string, anchor: MoveAnchor): Promise<Task>;

  /** Replace the entire ordering for this list. ids must be the exact set
   *  of currently active (non-archived) tasks; throws on missing/extra ids. */
  reorder(ids: readonly string[]): Promise<readonly Task[]>;
}

type MoveAnchor =
  | { before: string }
  | { after: string }
  | { position: "top" | "bottom" };
```

Why these two mutators:

- `move(id, anchor)` covers "drag this above that" / "send to end" — the 90% case in any UI.
- `reorder(ids[])` covers bulk drag-drop / list-replacement. One write, no per-step renames.

Why no `swap(a, b)` or `setPosition(id, n)`:

- `swap` is `reorder([…])` with two indices flipped — trivial in the caller.
- `setPosition(id, n)` invites off-by-one bugs and races (`n` becomes wrong if anyone else inserted). `before`/`after` is content-addressed and stable under concurrent edits.

### 3a-bis. Default sort is priority; opt out via `order`

Current: `all()` returns tasks sorted alphabetically by `qualifiedId` ([backends/utils.ts:23-25](packages/task-list/src/backends/utils.ts#L23-L25)). New default: priority order. Callers who needed alphabetical pass `{ order: "alphabetical" }` explicitly.

Supported `order` values:

- `"priority"` (default): the order materialized in the backend (filename prefix for `markdown-dir`, YAML key order for `yaml-file`, project view order for `gh-issues`).
- `"alphabetical"`: by `qualifiedId`. The current default sort, now opt-in.
- `"created"`: by creation time, oldest first. Requires backends to track it. `markdown-dir` writes a `created` ISO timestamp into frontmatter on `create()`; `yaml-file` writes a `created` field on the task record; `gh-issues` reads `createdAt` from the issue. Existing tasks without a `created` field sort to the tail in `readdir` / map-key order.

`allTasks()` (top-level) gets the same `order` option. Lists are iterated in alphabetical list-name order regardless; `order` controls within-list sort only.

This is a **breaking default-sort change**. Acceptable because (a) the package is internal and pre-1.0, (b) "everything is ordered" is the simpler mental model, and (c) the alphabetical opt-out is one extra option literal.

### 3b. Semantics

- **Archived tasks are unordered.** `move`, `reorder`, and `ordered` ignore archived tasks. Archive is terminal anyway.
- **Newly created tasks append to the end.** `create()` adds the new id to the tail of the order. No new option on `TaskCreate`.
- **Deleted/archived tasks drop out of the order.** `delete()` and `fire(_, "archive")` remove the id from the order list.
- **`reorder` is set-equality strict.** It throws if the input is missing any active id or contains an unknown one. (Use `move` for incremental edits.)
- **No persistence of "after-archive" order.** If you unarchive (custom state machine), the task lands at the tail.

### 3c. Errors

Add to the existing error class set in [src/types.ts](packages/task-list/src/types.ts):

```ts
class OrderMismatchError extends Error { /* missing or extra ids in reorder() */ }
class AnchorNotFoundError extends Error { /* anchor id missing in move() */ }
```

`InvalidTransitionError` is reserved for state-machine events; ordering errors are a separate axis.

## 4. Ordering — storage layout

The two existing backends store tasks differently, so order has to land in two different places. Both should be visible to a human reading the file.

### 4a. `markdown-dir` — filename priority prefix

Filenames carry the order. Priority is visible the moment you `ls` the list directory.

```text
tasks/
  planning/
    01-ship-readme.md
    02-review-release.md
    03-cut-beta.md
    archive/
      old-thing.md          ← archived files have no prefix
```

Format: `<order>-<id>.md` where `<order>` is a zero-padded decimal integer. Padding width is per-list and grows automatically: a list with up to 99 active tasks pads to 2; once it crosses 100, a single rebalance writes 3-digit prefixes for everything in that list. Width is purely cosmetic (used for `ls` ordering) — the parser reads the integer regardless of pad.

#### Id parsing

Id = filename with `.md` stripped, then with the leading `^\d+-` prefix stripped. Examples:

- `01-ship-readme.md` → id `ship-readme`
- `ship-readme.md` (no prefix) → id `ship-readme` (back-compat)
- `2025-budget.md` (id starts with digits) → id `2025-budget` ← see ambiguity note below

Ambiguity: a hand-created file like `2025-budget.md` parses as id `budget` with order `2025`, which is wrong. Resolution: **the order prefix is only recognized when the integer is ≤ the current list's max width + 1 digit**, AND the rest of the filename is a valid `validateTaskId` value. Anything that fails either check is treated as a no-prefix file. We document this in the package README. Users with id collisions across the prefix boundary should rename.

#### Mutations

- `create({ id })` writes `<next>-<id>.md` where `<next>` is `(max-existing-order) + 1`. New tasks land at the tail.
- `move(id, { before: x })` renames `id`'s file to one less than `x`'s order, then cascade-shifts neighbors as needed to keep the integer sequence non-overlapping. Worst case: rename every file from the move target to the old position. We accept that — it's the cost of "priority lives in the filename".
- `move(id, { position: "top" })` → cascade-shift everyone else down by one, place `id` at `01`. Same worst case.
- `reorder(ids[])` writes the entire list once: rename each file to `<index+1>-<id>.md`. One pass, no incremental cascade. Prefer this for bulk moves.
- `fire(id, "archive")` strips the prefix on the rename into `archive/`. Archived files have no order.
- Files with no prefix on read → treated as priority `Infinity` (tail). On the next mutation that touches the list, they get materialized with a real prefix.

#### Locking

Reorder operations need to lock the whole list, not just one task. The existing per-task-file lock pattern in [markdown-dir.ts:448-461](packages/task-list/src/backends/markdown-dir.ts#L448-L461) doesn't cover this. We add a list-level lock at `<listDir>/.order.lock` (a hidden lock file, not an order manifest — just the lock). `move` / `reorder` / `create` / `delete` / archiving `fire` all take it. The single-task `update` and non-archiving `fire` keep the per-task lock.

#### Rejected alternatives

| Option | Why not |
| --- | --- |
| Per-list `.order` YAML manifest | Priority isn't visible in `ls`. The user wants visibility — that's the whole point. |
| Frontmatter `order: <number>` | Same visibility problem. Plus fractional drift. |
| Sparse numbering (`010, 020, 030`) | Saves renames at first, fills up, then needs the same rebalance anyway. Tight numbering is simpler and the renames are git's problem, not ours. |

### 4b. `yaml-file` — rely on YAML key order

The `yaml-file` backend already stores tasks as a YAML map under `lists.<name>` and the `yaml` library preserves insertion order. We commit to that as the priority order:

- `create()` appends a new key at the end of the list map (already the default).
- `move` / `reorder` reorders the YAMLMap.items array directly, then writes.
- `all()` with default `{ order: "priority" }` returns tasks in the map's current key order.
- `all({ order: "alphabetical" })` runs the existing `sortTasks` path.

No new field, no schema change. The change to [yaml-file.ts:425](packages/task-list/src/backends/yaml-file.ts#L425) is to branch on `filter?.order` rather than always calling `sortTasks`.

### 4c. State machine and ordering

State and order are independent. `fire("archive")` removes from the order list as part of the existing archive write. No state machine changes. `defaultStateMachine` stays as-is.

## 5. `gh-issues` backend

The backend is a thin wrapper over a single (repo, project) pair: one project's items shown as one list of tasks, with the project's Status field supplying the state machine. No list selection, no Status-as-list — just open the project and operate on it.

### 5a. Configuration

```ts
const taskList = await openTaskList({
  type: "gh-issues",
  repo: "owner/name",
  project: { owner: "owner", number: 12 },     // GH Project (v2); both fields required
  // auth is optional — defaults to whatever `gh auth token` returns. See 5d.
});
```

`repo` and `project` are required. `OpenTaskListOptions` becomes a discriminated union over `type`:

```ts
type OpenTaskListOptions =
  | OpenMarkdownDirOptions
  | OpenYamlFileOptions
  | OpenGhIssuesOptions;

interface OpenGhIssuesOptions {
  type: "gh-issues";
  repo: string;                                  // "owner/name"
  project: { owner: string; number: number };
  defaults?: TaskDefaults;
  auth?: { token: string };                      // optional; see 5d
  fetch?: typeof fetch;                          // injectable for tests
}
```

`OpenGhIssuesOptions` deliberately excludes `path`, `create`, `lockStaleMs`, `lockRetries`, `fs`, and `stateMachine` — none apply. The state machine is fetched from the project (5c), not configured.

### 5b. Mapping

| `task-list` concept | GitHub mapping |
| --- | --- |
| backend instance | one repo + one project |
| `lists()` | returns a single name: `<owner>/<number>` (the project itself). `taskList.list(name)` accepts only that name. |
| `id` | Issue number as a string (`"482"`). |
| `name` | Issue title. |
| `description` | Issue body. |
| `state` | The current value of the project's Status field for this item. See 5c. |
| `metadata` | `{ url, labels: string[], assignees: string[], milestone: string \| null, projectItemId: string }`. |
| priority order | The project view's row order, read via the GraphQL `items` connection. |
| `created` | Issue `createdAt` (ISO 8601). Used for `order: "created"`. |

The earlier "Status as list" framing is dropped. Status is now the **state axis**, and the backend has only one list. This collapses the model: a GH Project is "a list of tasks with a state", and that's exactly what `Tasks` already is.

`taskList.lists()` always returns `[<owner>/<number>]`. `taskList.list("anything-else")` throws `Error("gh-issues backend has a single list <owner>/<number>")`. `moveBetweenLists` is unsupported (only one list); it throws the same error.

### 5c. State machine — fetched and dynamic

At `openTaskList` time, the backend issues a GraphQL query for the project's Status field and its options. The state machine is **derived** from those options:

- `states` = the Status field's option names, in the project's display order.
- `initial` = the first option (typically `"Backlog"` or whatever the project owner put first).
- `events` = one event per state: `event name = state name`, `from: "*"`, `to: <state>`. Any state can transition to any other state. No guards.

Result: `tasks.fire(id, "in-progress")` updates the issue's Status to `"in-progress"` (the option must exist on the project; otherwise the call is a no-op at the type level since the event doesn't exist).

If the project has no `Status` field, `openTaskList` throws with a clear message: `` "Project `<owner>/<number>` has no Status field; gh-issues requires one." `` Adding the field is a one-time setup in the GH UI; we do not mutate project schema.

The state machine is **frozen at open time**. If the project owner adds, removes, or renames Status options mid-session, the backend keeps using the version it fetched on open. Re-open the backend to pick up changes. Documented in the package README.

`stateMachine` in `OpenTaskListOptions` is not accepted for `gh-issues` — there's no override path. The project's Status field is the source of truth.

#### Updating the project's Status options

The plan reads "fetch the possible states if possible, and update them" two ways. We pick one and move:

- We **fetch** Status options at open and use them as `states`.
- We **update** an item's Status (i.e., fire transitions) — that is the write side.
- We do **not** update the Status options themselves (adding new options, renaming them). That's project-schema mutation; the project owner does it in the GH UI. Doing it from a task-list call would surprise teammates and is a big enough surface that it deserves its own command if anyone wants it.

If you want to add a new state, add the option in GH first, then re-open the backend.

### 5d. Auth

The backend defers to the `gh` CLI's configured auth — same setup the user already has working from the terminal. No new login flow, no new env var, no separate config.

Resolution order:

1. If `auth: { token }` is passed explicitly, use it. (Escape hatch for tests / CI without `gh` installed.)
2. Otherwise, shell out to `gh auth token` once at backend open and cache the result for the session.
3. If `gh` is not installed or returns a non-zero exit, throw with a clear message: install `gh`, run `gh auth login`, or pass `auth: { token }`.

GraphQL endpoint follows `gh`'s convention: `GH_HOST` env var if set, else `https://api.github.com`. We do not parse `~/.config/gh/hosts.yml` directly; `gh auth token` already accounts for the active host.

Out of scope: OAuth flows, GitHub App auth, multi-host failover. The user has a working `gh` setup, we use it.

### 5e. Operation mapping

| `Tasks` method | GH mutation |
| --- | --- |
| `create({ id?, name, description })` | `createIssue` in repo, then `addProjectV2ItemById` to put it in the project, then `updateProjectV2ItemFieldValue` to set Status to `initial`. `id` is ignored on create — the GH-assigned issue number becomes the id. (The `TaskCreate.id` field becomes optional for this backend; documented.) |
| `update(id, patch)` | `updateIssue` for title/body. Metadata edits are no-ops at v1 — labels/assignees are read-only here; future work. |
| `fire(id, event)` | `updateProjectV2ItemFieldValue` setting Status to `event` (event name == target state name). |
| `delete(id)` | `deleteProjectV2Item` (removes from project; issue stays in repo, not closed). |
| `move(id, anchor)` | `updateProjectV2ItemPosition` to place the item before/after the anchor's project item. `top`/`bottom` use `null` / project end. |
| `reorder(ids)` | n positional updates in order. No batch mutation in the GraphQL API; we accept the n round-trips. |
| `all({ order })` | `priority` = project view row order; `alphabetical` = client-side sort by id; `created` = `createdAt`. |

Issue `state` (open/closed) is **not** part of the task-list state machine. Closing or reopening an issue is out of scope here; users do it in the GH UI. If they close an issue, it stays in the project at its current Status until removed.

### 5f. Reads, writes, caching

- All reads hit the GraphQL API; no caching in v1. (If this gets slow we add `@poe-code/cached-resource` later — there's already a package for it.)
- Writes are: create issue, edit title/body, add/remove project item, set Status field value, reorder project item. All via GraphQL.
- Lock options (`lockStaleMs`, `lockRetries`) don't apply. Concurrent writes are arbitrated by GitHub.
- Per `feedback_no_corner_cutting`: if a GraphQL response is malformed, throw a `MalformedTaskError` with the surfaced field, don't paper over it.

### 5g. Tests

The backend skips the conformance suite (no live API in unit tests). It gets its own colocated tests in [packages/task-list/src/backends/gh-issues.test.ts](packages/task-list/src/backends/gh-issues.test.ts) using an injectable `fetch` mock that returns recorded GraphQL responses (one fixture per test). Snapshot the **outgoing** GraphQL queries+variables to lock the wire shape; assert on the resulting `Task` shape from the response. The `gh auth token` shell-out is bypassed by passing `auth: { token: "test-token" }` in tests.

`@poe-code/process-runner` already exposes a process abstraction for shelling out — wire `gh auth token` through it (per `feedback_extend_not_duplicate`). No `child_process.spawn` in this package.

## 6. Conformance tests

[backends/conformance.test.ts](packages/task-list/src/backends/conformance.test.ts) already runs the same suite against both existing backends. Extend it with:

- Ordering: `move(before/after/top/bottom)`, `reorder` set-equality, `all()` default = priority after archive/delete/create, `all({ order: "alphabetical" })` round-trip.
- `markdown-dir`-only: filename prefix migration (no-prefix file is treated as tail; first mutation materializes a real prefix), padding-width rebalance at the 99→100 boundary, archive strips the prefix.
- The `gh-issues` backend skips the conformance run by default (no live API in unit tests). It gets its own snapshot-style tests against a recorded GraphQL fixture in [docs/SNAPSHOT_TESTING.md](docs/SNAPSHOT_TESTING.md) style.

## 7. Implementation order

If you want to ship this incrementally:

1. Ordering API surface in `types.ts` (`move`, `reorder`, `order` filter, `moveBetweenLists`) + conformance tests (red).
2. `yaml-file` ordering — YAML key order; `created` field on records.
3. `markdown-dir` ordering — filename prefix, list-level lock, `created` frontmatter timestamp, no-prefix back-compat.
4. `moveBetweenLists` on `TaskList` for both existing backends.
5. `gh-issues` backend skeleton (`openTaskList` + auth via `gh auth token` + `lists()` + `Tasks.all()` read-only).
6. `gh-issues` writes (`create`, `update`, `fire` for the GH-specific machine).
7. `gh-issues` ordering + `moveBetweenLists` (project Status field writes, item position).

Each step ships green tests before the next starts.
