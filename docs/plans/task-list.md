---
$schema: 'https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json'
kind: pipeline
version: 1
tasks:
  - id: file-lock-package
    title: Create @poe-code/file-lock package
    prompt: >
      Create a new package `@poe-code/file-lock` at `packages/file-lock/`.


      Layout:

      - `packages/file-lock/package.json` — name `@poe-code/file-lock`, deps:
      none beyond Node built-ins.

      - `packages/file-lock/src/index.ts` — exports `acquireFileLock`,
      `LockTimeoutError`, `FileLockOptions`, `FileLockFs`, `ReleaseLock`.

      - `packages/file-lock/src/lock.ts` — implementation.

      - `packages/file-lock/src/lock.test.ts` — unit tests using `memfs`.


      Public API:

      ```ts

      export interface FileLockOptions {
        staleMs?: number;     // default 30_000
        retries?: number;     // default 20
        minTimeout?: number;  // default 25
        maxTimeout?: number;  // default 250
        fs?: FileLockFs;      // default node fs/promises
        signal?: AbortSignal;
      }

      export type ReleaseLock = () => Promise<void>;

      export function acquireFileLock(filePath: string, options?:
      FileLockOptions): Promise<ReleaseLock>;

      export class LockTimeoutError extends Error {}

      ```


      Behavior:

      - Lockfile path is `<filePath>.lock`.

      - Atomicity primitive: `fs.open(lockPath, 'wx')` (NOT mkdir). On `EEXIST`
      retry with exponential backoff between `minTimeout` and `maxTimeout`.

      - After successful open, write `{ pid, host, acquiredAt }` JSON into the
      lockfile (best-effort — failure to write does not release the lock).

      - Stale cleanup: if `Date.now() - stat.mtimeMs > staleMs`, unlink the
      lockfile and retry immediately.

      - Release: closure that unlinks the lockfile; ENOENT is non-fatal;
      double-release is a no-op.

      - `AbortSignal` cancels acquisition mid-retry with an `AbortError`.

      - Throw `LockTimeoutError` after `retries` exhausted.


      Reference implementation to port:
      `packages/agent-harness-tools/src/lock.ts` (uses mkdir today). Port the
      structure, swap atomicity to `open(..., 'wx')` + JSON write, keep
      backoff/retry/stale-cleanup behavior identical.


      Tests (use `memfs`, never real disk I/O):

      - Acquires a fresh lock and releases cleanly.

      - Two concurrent acquires: exactly one wins; the loser retries until the
      winner releases.

      - Stale lock (`mtimeMs` older than `staleMs`) is reclaimed.

      - `LockTimeoutError` thrown when retries exhausted with a held lock.

      - Lockfile content is valid JSON `{ pid, host, acquiredAt }`.

      - Release tolerates ENOENT.

      - `AbortSignal` cancels acquisition mid-retry.


      Project conventions (CLAUDE.md):

      - TDD — write tests first.

      - Tests use `memfs` and finish fast.

      - No regex; declarative TS.

      - Package needs its own README listing env vars (none) and config options.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: harness-tools-relay
    title: Re-export file-lock from agent-harness-tools
    prompt: >
      Replace the implementation of `packages/agent-harness-tools/src/lock.ts`
      with a one-line re-export from `@poe-code/file-lock`, preserving the
      existing exported names so callers (`pipeline`, etc.) keep compiling.


      Steps:

      1. Add `@poe-code/file-lock` to
      `packages/agent-harness-tools/package.json` dependencies.

      2. Rewrite `packages/agent-harness-tools/src/lock.ts` to:
         ```ts
         export { acquireFileLock as lockWorkflow, type FileLockOptions as LockOptions } from "@poe-code/file-lock";
         ```
      3. Trim `packages/agent-harness-tools/src/lock.test.ts` to a smoke test
      asserting that `lockWorkflow === acquireFileLock`. Move the body of the
      original lock test into `packages/file-lock/src/lock.test.ts` (do this in
      the file-lock-package task, not here — here just remove/trim).

      4. Verify `packages/pipeline/src/lock/lock.ts` still compiles unchanged —
      it re-exports `lockWorkflow` and depends only on the public surface.


      Acceptance:

      - `npm test --workspace=@poe-code/agent-harness-tools` passes.

      - `npm test --workspace=@poe-code/pipeline` passes.

      - No other packages need code changes.


      Project conventions:

      - Do not add yourself as commit co-author.

      - Conventional commits.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: task-list-skeleton
    title: Create @poe-code/task-list skeleton with state machine
    prompt: >
      Create `@poe-code/task-list` at `packages/task-list/` with the public
      surface, internal types, state machine, and a dispatcher that throws "not
      yet implemented" for both backends. Backends come in later tasks.


      Layout:

      - `packages/task-list/package.json` — deps `yaml`, `@poe-code/file-lock`.

      - `packages/task-list/src/index.ts` — exports public surface.

      - `packages/task-list/src/types.ts` — types listed below.

      - `packages/task-list/src/state.ts` — state machine.

      - `packages/task-list/src/open.ts` — dispatcher.

      - `packages/task-list/src/state.test.ts` — state machine tests.

      - `packages/task-list/src/open.test.ts` — dispatcher tests.

      - `packages/task-list/src/schema/task.schema.json` — JSON Schema for a
      single task.

      - `packages/task-list/src/schema/store.schema.json` — JSON Schema for the
      YAML multi-list store.


      Public surface:

      ```ts

      export type TaskState = "draft" | "planned" | "in-progress" | "done" |
      "archived";


      export interface Task {
        list: string;
        id: string;
        qualifiedId: string;       // `${list}/${id}`
        name: string;
        state: TaskState;
        description: string;
        metadata: Record<string, unknown>;
      }


      export interface TaskCreate {
        id: string;
        name: string;
        state?: TaskState;
        description?: string;
        metadata?: Record<string, unknown>;
      }


      export interface TaskUpdate {
        name?: string;
        description?: string;
        metadata?: Record<string, unknown>;
      }


      export interface ListFilter {
        state?: TaskState;
        includeArchived?: boolean;
      }


      export interface Tasks {
        readonly name: string;
        all(filter?: ListFilter): Promise<Task[]>;
        get(id: string): Promise<Task>;
        create(input: TaskCreate): Promise<Task>;
        update(id: string, patch: TaskUpdate): Promise<Task>;
        transition(id: string, to: TaskState): Promise<Task>;
        delete(id: string): Promise<void>;
      }


      export interface TaskList {
        list(name: string): Tasks;
        lists(): Promise<string[]>;
        allTasks(filter?: ListFilter): Promise<Task[]>;
        get(qualifiedId: string): Promise<Task>;
      }


      export interface TaskDefaults {
        state?: TaskState;
        metadata?: Record<string, unknown>;
      }


      export interface OpenTaskListOptions {
        type: "markdown-dir" | "yaml-file";
        path: string;
        defaults?: TaskDefaults;
        create?: boolean;
        lockStaleMs?: number;
        lockRetries?: number;
        fs?: TaskListFs;
      }


      export function openTaskList(options: OpenTaskListOptions):
      Promise<TaskList>;


      export class TaskNotFoundError extends Error {}

      export class TaskAlreadyExistsError extends Error {}

      export class InvalidTransitionError extends Error {}

      export class MalformedTaskError extends Error {}

      ```


      State machine in `state.ts`:

      ```ts

      export const LEGAL_TRANSITIONS: Readonly<Record<TaskState,
      ReadonlySet<TaskState>>> = {
        draft: new Set(["planned", "archived"]),
        planned: new Set(["in-progress", "draft", "archived"]),
        "in-progress": new Set(["done", "planned", "archived"]),
        done: new Set(["archived", "in-progress"]),
        archived: new Set(),
      };

      export function assertTransition(from: TaskState, to: TaskState): void;

      // Throws InvalidTransitionError naming both states if the transition is
      not in LEGAL_TRANSITIONS[from].

      ```


      Dispatcher (`open.ts`):

      - Validate `options.type` against `"markdown-dir" | "yaml-file"`. Unknown
      values throw.

      - Normalize `defaults`: `state` falls back to `"draft"`; `metadata` falls
      back to `{}`.

      - Pass normalized `BackendDeps` to the chosen backend factory.

      - For now, each backend factory throws `Error("not yet implemented")`.

      - `create: true` is accepted but not yet acted upon (backends own that
      behavior).


      Internal types (`types.ts`, not in public index):

      ```ts

      export interface BackendDeps {
        path: string;
        defaults: Required<TaskDefaults>;
        lockStaleMs: number;
        lockRetries: number;
        create: boolean;
        fs: TaskListFs;
      }

      export type BackendFactory = (deps: BackendDeps) => Promise<TaskList>;

      ```


      Tests:

      - `state.test.ts`: every legal transition returns the new state; every
      illegal transition throws `InvalidTransitionError`; every transition out
      of `archived` is rejected.

      - `open.test.ts`: `type: "markdown-dir"` and `type: "yaml-file"` route to
      their (placeholder) factories; unknown `type` throws; `defaults`
      normalized correctly (state → "draft", metadata → {}).


      JSON schemas (draft 2020-12) for both task and store. Schemas mirror the
      TS types and are the source of truth. No zod (project convention).


      Project conventions:

      - Use `yaml` library (already a dep), not regex.

      - Tests use `memfs`.

      - No code comments unless WHY is non-obvious.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: markdown-dir-backend
    title: Implement markdown-dir backend
    prompt: >
      Implement the `markdown-dir` backend in `@poe-code/task-list`. The
      skeleton, types, state machine, and dispatcher already exist.


      Files:

      - `packages/task-list/src/backends/markdown-dir.ts` — `export async
      function markdownDirBackend(deps: BackendDeps): Promise<TaskList>`.

      - `packages/task-list/src/backends/markdown-dir.test.ts` — unit tests with
      `memfs`.

      - `packages/task-list/src/backends/conformance.test.ts` — generic suite
      parametrized over backends; this task adds the suite and runs it against
      the markdown backend (yaml backend will join in the next task).

      - `packages/task-list/src/open.ts` — wire `markdownDirBackend` into the
      dispatcher's switch.


      Storage layout:

      - `<root>/<list>/<id>.md` for active tasks.

      - `<root>/<list>/archive/<id>.md` for archived tasks.

      - Locking: per-task lock at `<root>/<list>/<id>.md.lock` via
      `acquireFileLock` from `@poe-code/file-lock`.


      Task file format:

      ```markdown

      ---

      $schema:
      https://poe-platform.github.io/poe-code/schemas/task-list/task.schema.json

      kind: task

      version: 1

      name: <human-readable name>

      state: <TaskState>

      <metadata fields ...>

      ---


      <description body>

      ```


      Behavior of `TaskList` operations on this backend:

      - `taskList.list(name)` returns a `Tasks` view; the directory
      `<root>/<name>/` is NOT created until the first `create` call (lazy).

      - `taskList.lists()` returns directory names directly under `<root>`
      (excluding `archive`, lockfiles, hidden files).

      - `taskList.allTasks(filter?)` walks every list and aggregates.

      - `taskList.get(qualifiedId)` parses `<list>/<id>` and looks up; finds
      tasks in either `<list>/` or `<list>/archive/`.

      - `tasks.all(filter?)` walks `<list>/` only (top-level), unless
      `includeArchived: true` then also walks `<list>/archive/`. Filter by state
      if provided.

      - `tasks.get(id)`: looks in both `<list>/` and `<list>/archive/`; throws
      `TaskNotFoundError` if missing.

      - `tasks.create(input)`: under per-task lock, fail with
      `TaskAlreadyExistsError` if file exists in either location; write
      `<list>/<id>.md` with frontmatter merging `defaults` + input (input wins
      per field). Use tmp + rename for atomicity.

      - `tasks.update(id, patch)`: under per-task lock, read existing file,
      shallow-merge `metadata`, replace name/description if provided, preserve
      unknown frontmatter keys, write via tmp + rename. Never overwrite without
      reading first.

      - `tasks.transition(id, to)`: under per-task lock, read existing, call
      `assertTransition`, write updated frontmatter; if `to === "archived"`,
      also `rename` the file from `<list>/<id>.md` to `<list>/archive/<id>.md`
      (rejecting if archive target already exists).

      - `tasks.delete(id)`: under per-task lock, unlink the file from whichever
      location holds it.


      Validation:

      - List names: reject `/`, `\`, `..`, leading `.`, and the reserved name
      `archive`.

      - Ids: reject `/`, `\`, `..`, leading `.`.

      - Read-time validation against `task.schema.json`; failures throw
      `MalformedTaskError` with file path + which field failed.

      - Frontmatter parsing uses the `yaml` library (mirror
      `packages/superintendent/src/document/parse.ts`); preserve unknown keys on
      round-trip.


      Initialization:

      - `openTaskList({ create: true })` ensures `<root>` exists. If `<root>` is
      absent, `mkdir` it; if present, no-op (never rewrite).

      - `create: false` (default) and missing `<root>` → throw on
      `openTaskList`.


      Conformance suite (`conformance.test.ts`):

      - Parametrize over a backend factory (this task: just markdown-dir).

      - Cover: create + read round-trip, defaults applied to omitted fields,
      never-overwrite on `create`, all CRUD ops, every legal transition, all
      illegal transitions throw, archive moves to expected location, multi-list
      operations (`lists`, `allTasks`, qualified-id `get`), filter by state,
      includeArchived flag.

      - Concurrent updates (same task) serialize; concurrent updates (different
      tasks or different lists) don't contend.

      - Filename safety violations rejected.


      Project conventions:

      - TDD; tests in `memfs`.

      - No regex; use `yaml` lib.

      - Atomic writes via tmp + rename.

      - Don't introduce unused abstractions.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: yaml-file-backend
    title: Implement yaml-file backend
    prompt: >
      Implement the `yaml-file` backend in `@poe-code/task-list`. The skeleton,
      types, state machine, dispatcher, and conformance suite already exist
      (added in markdown-dir task). This task wires up yaml-file and runs the
      conformance suite against it.


      Files:

      - `packages/task-list/src/backends/yaml-file.ts` — `export async function
      yamlFileBackend(deps: BackendDeps): Promise<TaskList>`.

      - `packages/task-list/src/backends/yaml-file.test.ts` — backend-specific
      tests.

      - `packages/task-list/src/backends/conformance.test.ts` — extend to also
      run against yaml-file.

      - `packages/task-list/src/open.ts` — wire `yamlFileBackend` into the
      dispatcher.


      Storage:

      - Single YAML file at `<path>` with shape:
        ```yaml
        $schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json
        kind: task-store
        version: 1
        lists:
          <list>:
            <id>:
              name: ...
              state: <TaskState>
              description: |
                ...
              <metadata fields ...>
        ```
      - Locking: whole-file lock at `<path>.lock` via `acquireFileLock`. All
      mutations across any list serialize on this lock.


      Behavior:

      - `taskList.lists()`: top-level keys under `lists:`.

      - `taskList.allTasks(filter?)`: iterate every list, every task; default
      filter excludes archived.

      - `taskList.get(qualifiedId)`: parse `<list>/<id>`, look up under
      `lists.<list>.<id>`; missing throws `TaskNotFoundError`.

      - `tasks.all(filter?)`: read `lists.<list>`; default excludes archived;
      `includeArchived: true` includes them.

      - `tasks.create(input)`: under store lock, re-read the file, fail with
      `TaskAlreadyExistsError` if `lists.<list>.<id>` already exists, merge
      defaults + input, write back via tmp + rename.

      - `tasks.update(id, patch)`: under store lock, re-read, shallow-merge
      metadata, update fields, write back. Preserve unknown task fields and
      unknown top-level keys.

      - `tasks.transition(id, to)`: under store lock, re-read,
      `assertTransition`, set new state in-place, write back. No file moves on
      archive — just change `state` to `archived`.

      - `tasks.delete(id)`: under store lock, re-read, delete the entry, write
      back.


      Validation:

      - Same name/id safety as markdown-dir backend (no `archive` reservation
      here — yaml has no special folder).

      - Schema validation on read against `store.schema.json` (whole file) and
      `task.schema.json` (each task entry); failures throw `MalformedTaskError`
      naming the list + id.


      Initialization:

      - `openTaskList({ create: true })`: if `<path>` is missing, write `lists:
      {}` plus `$schema`/`kind`/`version`. If present, no-op.

      - `create: false` and missing `<path>` → throw.


      Conformance: extend `conformance.test.ts` to run the same suite against
      `yamlFileBackend`. Both backends must pass the same suite. Write
      yaml-specific tests for: round-trip preservation of unknown top-level
      keys, malformed task entry naming the bad list+id, whole-file lock
      serializing concurrent updates across lists.


      Project conventions:

      - `yaml` lib for parse/serialize; `Document` API to round-trip with
      comments preserved if practical.

      - Atomic writes via tmp + rename.

      - Tests in `memfs`.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
  - id: package-readmes
    title: Write READMEs for file-lock and task-list
    prompt: >
      Write `README.md` for both new packages, per project convention (every
      package must have a README listing env vars and config options).


      `packages/file-lock/README.md`:

      - Overview: what the package does (atomic file locking with timestamped
      stale cleanup).

      - Public API: `acquireFileLock(filePath, options?)` signature and behavior
      summary.

      - Options table: `staleMs`, `retries`, `minTimeout`, `maxTimeout`,
      `signal`, `fs` (with defaults).

      - Env vars: none.

      - One short usage example showing acquire + try/finally release.

      - Note that `agent-harness-tools` re-exports `acquireFileLock` as
      `lockWorkflow`.


      `packages/task-list/README.md`:

      - Overview: multi-list task manager with pluggable backends.

      - Backends: `markdown-dir` (one file per task in subdirectories per list)
      and `yaml-file` (single YAML file with `lists:` mapping).

      - Public API summary: `openTaskList`, `TaskList`, `Tasks`, `Task`,
      `TaskState`, `TaskDefaults`, error classes.

      - Lifecycle: `draft → planned → in-progress → done → archived`. `archived`
      is terminal.

      - Options table: `type`, `path`, `defaults`, `create`, `lockStaleMs`,
      `lockRetries`, `fs` (with defaults).

      - Env vars: none.

      - Two short usage examples — one per backend — showing open + create +
      transition.

      - Note: never overwrites existing files; defaults seed missing fields on
      new tasks only.


      Do not add the README content to the project root README. Do not modify
      any other README. The user must explicitly approve any other README
      changes.


      Project conventions:

      - Don't add anything to the top-level README without user permission.

      - Keep READMEs scoped to their own package.
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# Context

Pipeline plan that drives implementation of the `task-list` design described in [task-list.md](task-list.md). That design doc is the source of truth for shape and semantics; this file is the executable build order.

## Build order

1. `file-lock-package` — extract lock utility into a standalone package (file-based atomicity, stale cleanup).
2. `harness-tools-relay` — replace agent-harness-tools/lock with a one-liner re-export so existing callers (pipeline, etc.) keep working.
3. `task-list-skeleton` — types, state machine, dispatcher with placeholder backends.
4. `markdown-dir-backend` — first concrete backend; introduces the conformance test suite.
5. `yaml-file-backend` — second concrete backend; reuses the conformance suite.
6. `package-readmes` — both new packages get their own README per project convention.

Each task carries the entire context needed to execute it — file paths, signatures, behavioral rules, and project conventions — so steps run independently against the codebase as it stands at task start.

## Acceptance summary

- `npm test` green across all touched packages at every step.
- No callers of `lockWorkflow` need to change.
- Both backends pass an identical conformance suite.
- Never-overwrite invariant holds: `create` always errors on existing id; `update`/`transition` always read before write under the lock.
- Defaults seed only missing fields on new tasks; existing tasks are never modified by defaults.

# Task List

A pluggable task store with multiple storage backends, a shared lifecycle state machine, and a small file-locking package shared with the rest of the codebase.

## 1. What we're building

Two new packages:

1. **`@poe-code/file-lock`** — a tiny library that owns "atomically acquire an exclusive lock on a file path with a timestamped, stale-cleanup policy." It replaces the inline lock helper currently inside [`packages/agent-harness-tools/src/lock.ts`](packages/agent-harness-tools/src/lock.ts:102) and is consumed both by `agent-harness-tools` (re-exported for back-compat) and by the new task-list backends.
2. **`@poe-code/task-list`** — a multi-list task manager. One instance is rooted at a path with a backend type and exposes multiple named lists (e.g. `todo`, `bugs`, `release`) under that root. Two backends:
   - **Markdown directory** — `<root>/<list>/<id>.md`. Each subdirectory of `<root>` is a list; each `.md` file is a task. Frontmatter holds the human-readable name + all metadata; markdown body is the description. Archived tasks are physically moved into `<root>/<list>/archive/<id>.md`, matching the convention used by `ralph` (see [`packages/ralph`](packages/ralph/src/ralph.test.ts#L715)).
   - **Single YAML file** — `<root>` is one YAML file with a top-level `lists:` mapping. Each key under `lists:` is a list name; each entry under it is a task. Archived tasks stay in-file with `state: archived`; the YAML backend has no separate archive section.

Both backends use `@poe-code/file-lock` for safe concurrent writes.

**Task shape (shared across backends).**

- `list`: name of the list this task belongs to (e.g. `todo`).
- `id`: bare id, unique within its list (markdown backend: filename without extension; yaml backend: map key).
- `qualifiedId`: `<list>/<id>` — the externally addressable form, used when crossing list boundaries.
- `name`: human-readable title.
- `state`: lifecycle state — `draft` → `planned` → `in-progress` → `done` → `archived`.
- `description`: free text. Markdown body in the markdown backend; a string field in YAML.
- Open-ended metadata bag for backend-agnostic extras (priority, tags, owner, links). All extras live in frontmatter / yaml fields, never in the body.

No timestamps in this version. Mtime on disk is good enough; if callers later need created/updated tracking we can add it without a breaking change.

**Locking.**

- File-based lock (`fs.open(path, 'wx')`), not mkdir. Both are atomic on every platform Node currently supports; the file form is more idiomatic and lets us record diagnostics (pid, host, acquired-at) inside the lockfile. The mtime-based stale cleanup is preserved.
- Per-task locks in the markdown backend (`<list>/<id>.md.lock` next to the task file). Different tasks (in same or different lists) can be edited concurrently.
- Whole-file lock in the YAML backend — the file is one shared resource for all lists.

**Combines with existing progress trackers, doesn't replace them.**

- The lifecycle states are a superset of pipeline/ralph/superintendent vocabularies, chosen so they map cleanly. Pipeline `done` ↔ task-list `done`. Ralph `open` ↔ task-list `planned`. Superintendent `in_progress` ↔ `in-progress`, `completed` ↔ `done`.
- Task-list is *one option* for systems that today hand-roll a tracker. Existing trackers stay where they are; we don't rip them out in this plan.

### In scope

- `@poe-code/file-lock` package with file-based locking + stale cleanup.
- `@poe-code/task-list` package with backend interface + markdown-dir + yaml-file implementations.
- Multi-list semantics: one instance manages many named lists; per-list views for scoped operations and a root view for cross-list operations.
- Lifecycle state machine with the five states above and validation of legal transitions.
- Listing, getting, creating, updating, deleting, and state-transitioning tasks.
- Migrating `agent-harness-tools/src/lock.ts` to a thin re-export from `@poe-code/file-lock` so callers don't break.

### Out of scope

- SQLite or any third backend.
- Migrating pipeline / ralph / superintendent / experiment-loop to use task-list as their backing store.
- Task scheduling, dependencies, queues, search/query DSL, fuzzy matching.
- A CLI surface, MCP server, or interactive UI.
- Multi-host coordination, networked locks, or advisory `flock(2)` syscalls.

## 2. User-facing shape

### Package: `@poe-code/file-lock`

```ts
import { acquireFileLock, type FileLockOptions } from "@poe-code/file-lock";

const release = await acquireFileLock("/abs/path/to/file.md", {
  staleMs: 30_000,
  retries: 20
});
try {
  // ...do exclusive work on file.md
} finally {
  await release();
}
```

`acquireFileLock(path, options?)` returns a release function. The lock file is `<path>.lock` and contains a small JSON record (`{ pid, host, acquiredAt }`) for diagnostics. Stale cleanup is mtime-based — if `now - mtime > staleMs`, the lock is silently reclaimed. Defaults match today's `lockWorkflow`: 30s stale, 20 retries, 25–250ms backoff.

`agent-harness-tools` re-exports `acquireFileLock` as `lockWorkflow` so existing callers continue to compile.

### Package: `@poe-code/task-list`

Open the multi-list root once. Get scoped per-list views via `.list(name)`. Cross-list operations live on the root.

```ts
import { openTaskList } from "@poe-code/task-list";

const tasks = await openTaskList({
  type: "markdown-dir",
  path: ".poe-code/tasks"
});

// per-list operations
const todo = tasks.list("todo");
await todo.create({ id: "auth-bug", name: "Login redirect loops", state: "draft" });
await todo.update("auth-bug", {
  description: "Repro: open /login while authed → infinite redirect.",
  metadata: { priority: "high", owner: "kj" }
});
await todo.transition("auth-bug", "planned");
const todoItems = await todo.all();
const inProgress = await todo.all({ state: "in-progress" });
const one = await todo.get("auth-bug");
await todo.delete("legacy-task");

// cross-list / root operations
const lists = await tasks.lists();              // ["todo", "bugs", "release"]
const everything = await tasks.allTasks();      // Task[] across every list
const byQid = await tasks.get("todo/auth-bug"); // qualified-id lookup
```

Same code works for the YAML backend — only the `openTaskList` call changes:

```ts
const tasks = await openTaskList({
  type: "yaml-file",
  path: ".poe-code/tasks.yaml"
});
```

### Example layout — markdown backend

```text
.poe-code/tasks/
├── todo/
│   ├── auth-bug.md
│   ├── release-notes.md
│   └── archive/
│       └── stale-thing.md
└── bugs/
    └── perf-regression.md
```

`.poe-code/tasks/todo/auth-bug.md`:

```markdown
---
$schema: https://poe-platform.github.io/poe-code/schemas/task-list/task.schema.json
kind: task
version: 1
name: Login redirect loops
state: in-progress
priority: high
owner: kj
tags: [auth, regression]
---

Repro: open `/login` while authed → infinite redirect.

Likely culprit: the new session-refresh middleware doesn't short-circuit when a valid session is already present.
```

The directory `todo/` is the list name; the filename `auth-bug.md` is the bare id; the qualified id is `todo/auth-bug`. Frontmatter holds everything structured; body is the description. Unknown frontmatter keys are preserved on round-trip — they're metadata.

### Example layout — yaml backend

`.poe-code/tasks.yaml`:

```yaml
$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json
kind: task-store
version: 1
lists:
  todo:
    auth-bug:
      name: Login redirect loops
      state: in-progress
      description: |
        Repro: open /login while authed → infinite redirect.
      priority: high
      owner: kj
      tags: [auth, regression]
    release-notes:
      name: Draft 0.42 release notes
      state: planned
  bugs:
    perf-regression:
      name: 30% slowdown on cold start
      state: planned
```

### Lifecycle state machine

```text
draft ──► planned ──► in-progress ──► done ──► archived
   │          ▲             │           ▲          ▲
   │          └─────────────┘           │          │
   └────────────────────────────────────┘          │
              (any state) ──────────────────────────┘
```

Legal transitions:

- `draft → planned` (ready), `draft → archived` (abandoned).
- `planned → in-progress` (start), `planned → draft` (deferred), `planned → archived`.
- `in-progress → done`, `in-progress → planned` (paused), `in-progress → archived`.
- `done → archived`, `done → in-progress` (re-opened — bug came back).
- `archived` is terminal; transitioning out of `archived` is rejected.

Illegal transitions throw `InvalidTransitionError` with both states named in the message.

### Archiving on disk

- **Markdown backend.** `transition(id, "archived")` writes the updated frontmatter, then moves the file from `<root>/<list>/<id>.md` to `<root>/<list>/archive/<id>.md`. `all()` reads only the top-level list directory by default; pass `{ includeArchived: true }` to also walk `archive/`. `get`/`update`/`delete` look in both locations and operate on whichever holds the id.
- **YAML backend.** No file move. The entry stays under `lists.<list>` with `state: archived`. `all()` filters out archived by default; pass `{ includeArchived: true }` to include them.

### Defaults and never-overwrite

- The factory takes a `defaults` block. Anything you don't pass to `create({ id, name })` is filled in from defaults. The only field with a built-in fallback is `state: "draft"`; `name` is always required from the caller.
- Defaults apply **only** to fields not present in the create payload. They never modify existing tasks on disk.
- The package never overwrites a task file it didn't read first. All writes go through read-modify-write under the lock; if a task already exists on disk, `create` rejects with `TaskAlreadyExistsError` rather than clobbering. `update` and `transition` re-read the current file content under the lock before composing the new content.
- Initialization (`create: true`) only writes when the target is *missing*: it `mkdir`s the markdown root if absent or writes a fresh empty `lists: {}` YAML if the file is absent. If the path already exists, initialization is a no-op — never a rewrite.

### Errors

- `TaskNotFoundError` — `get`/`update`/`delete`/`transition` on a missing id.
- `TaskAlreadyExistsError` — `create` with an existing id.
- `InvalidTransitionError` — illegal state transition.
- `LockTimeoutError` — could not acquire the file lock within `retries`.
- `MalformedTaskError` — file on disk failed schema validation.

## 3. Implementation details and technical decisions

### Repository layout

```text
packages/
  file-lock/
    src/
      index.ts          # public surface
      lock.ts           # acquireFileLock
      lock.test.ts
    package.json
    README.md
  task-list/
    src/
      index.ts          # public surface
      types.ts          # Task, TaskState, TaskList, Tasks, errors
      state.ts          # state machine + legal transitions
      open.ts           # openTaskList dispatcher
      backends/
        markdown-dir.ts
        markdown-dir.test.ts
        yaml-file.ts
        yaml-file.test.ts
      schema/
        task.schema.json
        store.schema.json
    package.json
    README.md
```

`@poe-code/agent-harness-tools` keeps `lock.ts` as a one-liner re-export from `@poe-code/file-lock`, preserving today's exports (`lockWorkflow`, `LockOptions`).

### Backend interface

`openTaskList` is a dispatcher; backends implement a common interface and own all I/O. There are no `if (backend === ...)` branches in the dispatcher beyond instantiation.

### Why a dispatcher and not a registry

The codebase has two backends today and one explicitly out-of-scope (sqlite). A two-line `switch` in `open.ts` is shorter than a registry, and adding a third backend tomorrow is one new file + one switch arm. No plugin registration ceremony.

### Locking semantics

- The lock package owns acquisition + release + stale detection. Backends decide what to lock and when.
- **Markdown backend.** Per-task lock at `<root>/<list>/<id>.md.lock` (sibling). Held only for the duration of write/transition/delete on that one task. Different lists (or different tasks within the same list) don't contend.
- **YAML backend.** Whole-file lock at `<path>.lock`. Held for any mutation across any list; the entire file is rewritten on every write because YAML doesn't support partial updates without re-serializing.
- Stale window default: 30s, overridable via `openTaskList({ lockStaleMs })`.
- Lock file content: `{ pid, host, acquiredAt }` JSON, written after `wx` open succeeds. Best-effort — if the write fails we still hold the lock and return.

### Frontmatter parsing and round-tripping

- Use the `yaml` library directly (matches [`packages/superintendent/src/document/parse.ts`](packages/superintendent/src/document/parse.ts:1)). Don't depend on `markdown-reader` — it's read-only and section-oriented.
- Round-trip preserves unknown frontmatter keys: parse to a `Document`, mutate known fields, serialize. Don't drop user-added keys.
- Body is everything after the closing `---` fence, byte-preserved.

### Schema validation

- Both backends validate against `task.schema.json` / `list.schema.json` on read. Failures produce `MalformedTaskError` with file path + which field failed.
- Schemas are JSON Schema draft 2020-12 to match the rest of the repo (e.g. [superintendent schemas](packages/superintendent/src/document/parse.ts#L195)).
- Validation is plain TS guards — no zod (see project convention).

### Edge cases

- **Id collisions.** Markdown backend: a top-level `<list>/auth-bug.md` and an `<list>/archive/auth-bug.md` are the same id within that list. `create` rejects if either exists. `transition(..., 'archived')` rejects if the target archive path already exists (caller should `delete` first). YAML: simple map-key collision under the same list.
- **List-name and id safety.** Reject names/ids that would escape the root — anything containing `/`, `\`, `..`, leading `.`, or other path separators. The reserved name `archive` is forbidden as a list name on the markdown backend.
- **Cross-list ids.** A task with id `auth-bug` can exist in `todo` and in `bugs` independently. They are different tasks: qualified ids `todo/auth-bug` vs `bugs/auth-bug`.
- **Auto-creating lists.** `tasks.list("new-list")` returns a view immediately. The list directory / YAML key is created lazily on first `create` under that view.
- **Concurrent processes.** Two processes both contending: the `wx` open is atomic, so exactly one wins. The other retries.
- **Crashed writer.** Lock mtime exceeds `staleMs` → next acquirer reclaims it. This is the same property today's `lockWorkflow` provides.
- **Partial writes.** Write to `<file>.tmp`, then `rename` to `<file>` (atomic on POSIX, atomic-enough on Windows for our purposes). Same pattern as elsewhere in the repo.
- **Never-overwrite.** Every write path is read-modify-write under the lock. `create` errors if a task file/key already exists. `update` and `transition` re-read before composing the new content. The dispatcher's "init missing path" only fires when the path is absent.
- **Body whitespace.** Preserve trailing newline on write — markdown tools and editors assume it.
- **Empty store.** `openTaskList` on a non-existent path: markdown backend creates the root directory; yaml backend creates a file containing `lists: {}`. Both gated behind `{ create: true }` so accidental typos don't silently spawn directories.

### Configuration

`openTaskList` options:

| option | type | default | meaning |
| --- | --- | --- | --- |
| `type` | `"markdown-dir" \| "yaml-file"` | required | backend selector |
| `path` | `string` | required | root dir for markdown, file for yaml |
| `defaults` | `TaskDefaults` | `{ state: "draft" }` | seeded into new tasks for fields the caller omits |
| `create` | `boolean` | `false` | create the target if missing (never overwrite) |
| `lockStaleMs` | `number` | `30_000` | passed to file-lock |
| `lockRetries` | `number` | `20` | passed to file-lock |
| `fs` | injected fs | node `fs/promises` | for `memfs` in tests |

No env vars, no global config. The package is a library; consumers wire it.

## 4. Interfaces and test plan

### `@poe-code/file-lock` public surface

```ts
export interface FileLockOptions {
  staleMs?: number;     // default 30_000
  retries?: number;     // default 20
  minTimeout?: number;  // default 25
  maxTimeout?: number;  // default 250
  fs?: FileLockFs;      // default node fs/promises
  signal?: AbortSignal;
}

export interface FileLockFs {
  open(path: string, flags: "wx"): Promise<{ writeFile(data: string): Promise<void>; close(): Promise<void> }>;
  unlink(path: string): Promise<void>;
  stat(path: string): Promise<{ mtimeMs: number }>;
}

export type ReleaseLock = () => Promise<void>;

export function acquireFileLock(filePath: string, options?: FileLockOptions): Promise<ReleaseLock>;

export class LockTimeoutError extends Error {}
```

### `@poe-code/task-list` public surface

```ts
export type TaskState = "draft" | "planned" | "in-progress" | "done" | "archived";

export interface Task {
  list: string;                            // list name
  id: string;                              // bare id within the list
  qualifiedId: string;                     // `${list}/${id}`
  name: string;
  state: TaskState;
  description: string;                     // body for markdown, field for yaml
  metadata: Record<string, unknown>;       // unknown frontmatter / yaml keys
}

export interface TaskCreate {
  id: string;                              // bare id (list is implied by the view)
  name: string;
  state?: TaskState;                       // falls back to defaults.state, then "draft"
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskUpdate {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;      // shallow-merged with existing
}

export interface ListFilter {
  state?: TaskState;
  includeArchived?: boolean;               // default false
}

// Single-list view (returned by TaskList.list(name)).
export interface Tasks {
  readonly name: string;
  all(filter?: ListFilter): Promise<Task[]>;
  get(id: string): Promise<Task>;
  create(input: TaskCreate): Promise<Task>;
  update(id: string, patch: TaskUpdate): Promise<Task>;
  transition(id: string, to: TaskState): Promise<Task>;
  delete(id: string): Promise<void>;
}

// Multi-list root (returned by openTaskList).
export interface TaskList {
  list(name: string): Tasks;
  lists(): Promise<string[]>;
  allTasks(filter?: ListFilter): Promise<Task[]>;
  get(qualifiedId: string): Promise<Task>;
}

export interface TaskDefaults {
  state?: TaskState;                       // default "draft"
  metadata?: Record<string, unknown>;      // shallow-merged into new tasks
}

export interface OpenTaskListOptions {
  type: "markdown-dir" | "yaml-file";
  path: string;
  defaults?: TaskDefaults;
  create?: boolean;
  lockStaleMs?: number;
  lockRetries?: number;
  fs?: TaskListFs;
}

export function openTaskList(options: OpenTaskListOptions): Promise<TaskList>;

export class TaskNotFoundError extends Error {}
export class TaskAlreadyExistsError extends Error {}
export class InvalidTransitionError extends Error {}
export class MalformedTaskError extends Error {}
```

### Internal backend interface

Backends are not exported from the package surface. They implement `TaskList` (the multi-list root) directly; the dispatcher resolves the backend from `options.type` and instantiates it.

```ts
// internal — packages/task-list/src/types.ts
export interface BackendDeps {
  path: string;
  defaults: Required<TaskDefaults>;
  lockStaleMs: number;
  lockRetries: number;
  fs: TaskListFs;
}

export type BackendFactory = (deps: BackendDeps) => Promise<TaskList>;
```

### Test plan

**Unit, `@poe-code/file-lock`** — mirrors today's `agent-harness-tools/src/lock.test.ts`, ported.

- Acquires a fresh lock, returns a release function, releases cleanly.
- Two concurrent `acquireFileLock` calls — exactly one wins; the loser retries until released.
- Stale lock (`mtimeMs` older than `staleMs`) is reclaimed.
- `LockTimeoutError` thrown when retries exhausted.
- Lock file content contains valid JSON `{ pid, host, acquiredAt }`.
- Lockfile cleanup on release; ENOENT during release is non-fatal.
- `AbortSignal` cancels acquisition mid-retry.

**Unit, `@poe-code/task-list` — state machine** (`state.ts`).

- All legal transitions return the new state.
- Every illegal transition throws `InvalidTransitionError`.
- Every `archived → *` transition is rejected.

**Unit, markdown-dir backend.**

- `tasks.list("todo").create({ id, name })` writes `<root>/todo/<id>.md` with valid frontmatter; rejects if file exists in `<root>/todo` *or* `<root>/todo/archive`.
- `todo.all()` returns top-level tasks only; `{ includeArchived: true }` walks `archive/` too.
- `tasks.allTasks()` aggregates across every list directory.
- `tasks.lists()` returns the directory names under `<root>` (excluding `archive` and lockfile siblings).
- `get` finds tasks in either location.
- `update` round-trips: unknown frontmatter keys preserved, body preserved on no-op update.
- `transition(..., 'archived')` moves the file to `<list>/archive/` and updates `state`.
- `delete` removes the file regardless of which directory holds it.
- Concurrent `update` on the same id: per-task lock serializes them.
- Concurrent `update` on different ids (or different lists): no contention.
- Name safety: list names and ids with `/`, `\`, `..`, leading `.` are rejected; reserved name `archive` is rejected.
- Defaults: `state` and `metadata` from `defaults` apply only to fields the caller omitted; existing tasks are never modified by defaults.
- Never-overwrite: a `create` racing against a writer sees `TaskAlreadyExistsError`, never silent clobber.
- Tests use `memfs` (per project convention; see [`agent-harness-tools` lock test](packages/agent-harness-tools/src/lock.test.ts)).

**Unit, yaml-file backend.**

- `create` adds an entry to `lists.<list>`; `all` reads them per list, `allTasks` reads across lists.
- Whole-file lock serializes concurrent `update` calls regardless of which list/task.
- `transition(..., 'archived')` updates the entry in-place; no file move.
- `all` filters out archived by default; `{ includeArchived: true }` includes them.
- `lists()` returns top-level keys under `lists:`.
- Round-trip preserves unknown task fields and unknown top-level keys.
- Reading a YAML with a malformed task entry throws `MalformedTaskError` naming the list + id.
- Defaults are applied identically to the markdown backend; existing entries untouched.
- Never-overwrite: re-`create` of an existing key throws.

**Unit, dispatcher (`open.ts`).**

- Each `type` value selects the right backend.
- `create: true` initializes empty store on missing path; default `false` errors on missing path.
- `create: true` against an existing path is a no-op (never overwrites).
- `defaults.state` and `defaults.metadata` flow through to backends and surface in created tasks.
- `defaults` is normalized: `state` defaults to `"draft"` and `metadata` defaults to `{}`.
- Unknown `type` value throws.

**Integration, `agent-harness-tools` re-export.**

- Existing `lockWorkflow` callers continue to work — type and behavior unchanged.
- `pipeline` test that uses `lockFile` still passes (see [`packages/pipeline/src/lock/lock.ts`](packages/pipeline/src/lock/lock.ts:1)).

**Manual QA.**

- Create a real markdown-dir task list under `/tmp`. Run `node` REPL: create three tasks, transition through states, verify file moves to `archive/`, verify YAML round-trip in the other backend.
- Kill a process mid-write — lock stale-cleanup should let the next process proceed after `staleMs`.

### Rollout / migration

- `agent-harness-tools/src/lock.ts` becomes:

  ```ts
  export { acquireFileLock as lockWorkflow, type FileLockOptions as LockOptions } from "@poe-code/file-lock";
  ```

  All existing callers (`pipeline`, etc.) need no change.

- The current implementation moves verbatim into `@poe-code/file-lock/src/lock.ts`, then is generalized: `mkdir`-based atomicity → `open(..., 'wx')`-based, with the lockfile JSON write added.

- Existing `agent-harness-tools/src/lock.test.ts` moves to `@poe-code/file-lock/src/lock.test.ts`. The `agent-harness-tools` test for the re-export becomes a one-liner type/identity check.

### Autonomy checklist

For an agent picking this up to finish without further input:

1. New packages must follow repo conventions: own `README.md` listing env vars (none here) and config options.
2. Use `memfs` for filesystem tests (no real disk I/O), per CLAUDE.md.
3. No regex parsing of YAML frontmatter — use the `yaml` library, mirroring [`packages/superintendent/src/document/parse.ts`](packages/superintendent/src/document/parse.ts:1).
4. JSON Schema files are the single source of truth for shape; TS types match them by hand (no zod, no codegen).
5. The state machine lives in one file (`state.ts`) and is referenced by both backends — don't duplicate the transition table.
6. The dispatcher has a `switch` on `backend`, not an `if/else` ladder, and not a registry.
7. Tests for both backends share a generic suite that exercises the `TaskList` interface against any backend; backend-specific tests cover only behavior unique to that backend (file moves, locking granularity).
8. After the file-lock extraction, run the existing `pipeline` and `agent-harness-tools` tests to confirm the re-export hasn't broken anything.
9. Build order:
   1. `@poe-code/file-lock` (new package, port + generalize existing lock).
   2. Re-export from `agent-harness-tools`; run pipeline tests green.
   3. `@poe-code/task-list` types + state machine + dispatcher (no backends yet).
   4. markdown-dir backend + tests.
   5. yaml-file backend + tests.
   6. README for both packages.

## 5. Code plan

### Files to create

- [packages/file-lock/package.json](packages/file-lock/package.json) — name `@poe-code/file-lock`, deps: none beyond Node built-ins.
- [packages/file-lock/README.md](packages/file-lock/README.md) — package overview, env vars (none), config options.
- [packages/file-lock/src/index.ts](packages/file-lock/src/index.ts) — re-exports `acquireFileLock`, `LockTimeoutError`, types.
- [packages/file-lock/src/lock.ts](packages/file-lock/src/lock.ts) — `acquireFileLock(filePath, options?)`. Internals: `open(lockPath, 'wx')`, write `{ pid, host, acquiredAt }`, return release closure that `unlink`s. Backoff + stale-mtime reclaim copied from existing implementation.
- [packages/file-lock/src/lock.test.ts](packages/file-lock/src/lock.test.ts) — unit tests using `memfs`.
- [packages/task-list/package.json](packages/task-list/package.json) — name `@poe-code/task-list`, deps: `yaml`, `@poe-code/file-lock`.
- [packages/task-list/README.md](packages/task-list/README.md) — overview, env vars (none), config options table copied from §3.
- [packages/task-list/src/index.ts](packages/task-list/src/index.ts) — public surface: `openTaskList`, `Task`, `TaskState`, `TaskList`, `Tasks`, `TaskDefaults`, errors.
- [packages/task-list/src/types.ts](packages/task-list/src/types.ts) — `Task`, `TaskState`, `TaskList`, `Tasks`, `TaskDefaults`, `BackendDeps`, `BackendFactory`, `OpenTaskListOptions`, `TaskListFs`.
- [packages/task-list/src/state.ts](packages/task-list/src/state.ts) — `LEGAL_TRANSITIONS: Record<TaskState, ReadonlySet<TaskState>>`, `assertTransition(from, to): void` throws `InvalidTransitionError`.
- [packages/task-list/src/open.ts](packages/task-list/src/open.ts) — `openTaskList(options)` switch on `type`, normalizes defaults, instantiates `markdownDirBackend` or `yamlFileBackend`.
- [packages/task-list/src/backends/markdown-dir.ts](packages/task-list/src/backends/markdown-dir.ts) — `markdownDirBackend(deps): Promise<TaskList>`. Helpers: `listDir(name)`, `taskFilePath(list, id)`, `archivePath(list, id)`, `readTaskFile`, `writeTaskFile` (tmp + rename), `withTaskLock(list, id, fn)`.
- [packages/task-list/src/backends/markdown-dir.test.ts](packages/task-list/src/backends/markdown-dir.test.ts).
- [packages/task-list/src/backends/yaml-file.ts](packages/task-list/src/backends/yaml-file.ts) — `yamlFileBackend(deps): Promise<TaskList>`. Helpers: `readStore`, `writeStore` (tmp + rename), `withStoreLock(fn)` for whole-file lock.
- [packages/task-list/src/backends/yaml-file.test.ts](packages/task-list/src/backends/yaml-file.test.ts).
- [packages/task-list/src/backends/conformance.test.ts](packages/task-list/src/backends/conformance.test.ts) — generic suite parametrized over both backends; covers create/list/get/update/transition/delete, multi-list semantics, defaults, and never-overwrite via the `TaskList` / `Tasks` interfaces.
- [packages/task-list/src/schema/task.schema.json](packages/task-list/src/schema/task.schema.json) — JSON Schema for a single task (markdown frontmatter shape).
- [packages/task-list/src/schema/store.schema.json](packages/task-list/src/schema/store.schema.json) — JSON Schema for the YAML multi-list store.

### Files to change

- [packages/agent-harness-tools/src/lock.ts](packages/agent-harness-tools/src/lock.ts) — replace 156-line implementation with a one-line re-export from `@poe-code/file-lock`. Keep `lockWorkflow` and `LockOptions` names exported.
- [packages/agent-harness-tools/src/lock.test.ts](packages/agent-harness-tools/src/lock.test.ts) — strip down to a smoke test that `lockWorkflow` is the same identity as `acquireFileLock`. Move the body of the original test to `@poe-code/file-lock`.
- [packages/agent-harness-tools/package.json](packages/agent-harness-tools/package.json) — add `@poe-code/file-lock` to deps.
- [packages/pipeline/src/lock/lock.ts](packages/pipeline/src/lock/lock.ts) — no change required; the existing re-export keeps working.

### Key signatures

```ts
// packages/file-lock/src/lock.ts
export async function acquireFileLock(
  filePath: string,
  options?: FileLockOptions
): Promise<ReleaseLock>;

// packages/task-list/src/state.ts
export const LEGAL_TRANSITIONS: Readonly<Record<TaskState, ReadonlySet<TaskState>>>;
export function assertTransition(from: TaskState, to: TaskState): void;

// packages/task-list/src/open.ts
export async function openTaskList(options: OpenTaskListOptions): Promise<TaskList>;

// packages/task-list/src/backends/markdown-dir.ts
export async function markdownDirBackend(deps: BackendDeps): Promise<TaskList>;

// packages/task-list/src/backends/yaml-file.ts
export async function yamlFileBackend(deps: BackendDeps): Promise<TaskList>;
```

### Build order (each step keeps the branch green)

1. **Add `@poe-code/file-lock`.** Port `agent-harness-tools/src/lock.ts` verbatim, then change atomicity primitive from `mkdir` to `open(..., 'wx')` with the JSON payload write. Tests pass in isolation.
2. **Re-export from `agent-harness-tools`.** Replace the file with a one-liner. Run the existing `lock.test.ts`, then the `pipeline` test suite. Both stay green.
3. **Add `@poe-code/task-list` skeleton.** `types.ts`, `state.ts`, `open.ts` (throws "not implemented" for both backends), schema files. Tests for the state machine pass.
4. **Implement markdown-dir backend** + its tests + the conformance suite running against it.
5. **Implement yaml-file backend** + its tests + conformance suite running against it.
6. **READMEs** for both packages with env var (none), config options, and a copy of the §2 examples.
