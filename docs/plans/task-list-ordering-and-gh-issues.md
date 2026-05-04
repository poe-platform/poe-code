---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: gh-issues-types
    title: Make TaskCreate.id optional + add OpenGhIssuesOptions to discriminated
      union
    prompt: |
      In `packages/task-list/src/types.ts`, do two things:

      1. Make `TaskCreate.id` optional: `id?: string`. Existing markdown-dir and
         yaml-file backends must continue to require it — add a runtime guard in
         each that throws `Error("id is required for <type> backend")` when
         `input.id === undefined`. The validation lives in the backend, not the
         type, so gh-issues can omit `id` legitimately.

      2. Convert `OpenTaskListOptions` from a flat interface into a discriminated
         union over `type`. Three variants:

         ```ts
         type OpenTaskListOptions =
           | OpenMarkdownDirOptions
           | OpenYamlFileOptions
           | OpenGhIssuesOptions;

         interface OpenMarkdownDirOptions {
           type: "markdown-dir";
           path: string;
           defaults?: TaskDefaults;
           create?: boolean;
           lockStaleMs?: number;
           lockRetries?: number;
           fs?: TaskListFs;
           stateMachine?: StateMachineDef;
         }

         // Same for OpenYamlFileOptions with type: "yaml-file".

         interface OpenGhIssuesOptions {
           type: "gh-issues";
           repo: string;                            // "owner/name"
           project: { owner: string; number: number };
           defaults?: TaskDefaults;
           auth?: { token: string };                // optional; see gh-issues-client task
           fetch?: typeof fetch;                    // injectable for tests
         }
         ```

         `OpenGhIssuesOptions` deliberately omits `path`, `create`, `lockStaleMs`,
         `lockRetries`, `fs`, and `stateMachine`.

      3. Update `BackendDeps` if needed so `markdown-dir` and `yaml-file` factories
         keep their existing input shape; gh-issues will get its own deps shape in
         the next task.

      4. Re-export from `packages/task-list/src/index.ts`: `OpenMarkdownDirOptions`,
         `OpenYamlFileOptions`, `OpenGhIssuesOptions`.

      Update `packages/task-list/src/open.ts` to handle the new union shape (gh-issues
      can throw `Error("gh-issues backend not yet implemented")` for now — wiring lands
      in the final task).

      Constraints:
      - No `if/case` on `type` outside of `open.ts`.
      - Keep existing tests passing.
    status:
      implement: done
      test: done
      commit: done

  - id: gh-issues-client
    title: GitHub GraphQL client + auth (gh auth token via @poe-code/process-runner)
    prompt: |
      Create `packages/task-list/src/backends/gh-issues-client.ts` exposing a typed
      GraphQL client for the GH Projects v2 API. Public surface:

      ```ts
      export interface GhClientOptions {
        token: string;
        endpoint: string;        // default "https://api.github.com/graphql"
        fetch?: typeof fetch;
      }

      export interface GhClient {
        graphql<T>(query: string, variables: Record<string, unknown>): Promise<T>;
      }

      export function createGhClient(options: GhClientOptions): GhClient;

      export interface ResolveAuthOptions {
        explicitToken?: string;
        // Injectable runner for tests; default uses @poe-code/process-runner host runner.
        runner?: import("@poe-code/process-runner").Runner;
      }
      export function resolveAuth(options: ResolveAuthOptions): Promise<string>;

      export interface ResolveEndpointOptions {
        env?: Record<string, string | undefined>; // default process.env
      }
      export function resolveEndpoint(options?: ResolveEndpointOptions): string;
      ```

      Behavior:

      - `resolveAuth`: if `explicitToken` is set, return it. Else shell out to
        `gh auth token` via the injected `Runner` (default: host runner from
        `@poe-code/process-runner`). Read stdout, trim. If exit code is non-zero or
        stdout is empty, throw `Error("gh auth token failed; install gh, run 'gh auth
        login', or pass auth: { token }")`.
      - `resolveEndpoint`: if `env.GH_HOST` is set and not "github.com", return
        `https://${GH_HOST}/api/graphql`. Otherwise `https://api.github.com/graphql`.
      - `createGhClient.graphql`: POSTs `{ query, variables }` JSON, sets
        `Authorization: Bearer <token>`, `Content-Type: application/json`,
        `User-Agent: poe-code-task-list/0.0.1`. On non-200, throw with status + body.
        On `errors` array in response, throw with the first error's message.

      Add `@poe-code/process-runner` as a dependency in
      `packages/task-list/package.json` (we use the host runner to invoke `gh`).

      Tests in `packages/task-list/src/backends/gh-issues-client.test.ts`:
      - `resolveAuth` returns explicit token without invoking runner.
      - `resolveAuth` shells out to `gh auth token` and trims output.
      - `resolveAuth` throws when runner exit code is non-zero (mock the runner with
        a stub that returns a configurable exit code + stdout/stderr).
      - `resolveEndpoint` honors GH_HOST.
      - `createGhClient.graphql` injects auth header, posts the query, returns `data`,
        and throws on `errors` (mock fetch).

      Constraints:
      - No `child_process.spawn` directly — go through `@poe-code/process-runner`.
      - No `@modelcontextprotocol/sdk`.
      - Tests mock fetch + runner; no live network.
    status:
      implement: done
      test: done
      commit: done

  - id: gh-issues-skeleton
    title: gh-issues backend skeleton — open, fetch Status field, build state machine
    prompt: |
      Create `packages/task-list/src/backends/gh-issues.ts` exporting:

      ```ts
      export async function ghIssuesBackend(deps: GhIssuesBackendDeps): Promise<TaskList>;

      export interface GhIssuesBackendDeps {
        repo: string;
        project: { owner: string; number: number };
        defaults: Required<TaskDefaults>;
        token: string;
        endpoint: string;
        fetch?: typeof fetch;
      }
      ```

      `ghIssuesBackend(deps)` does the following on open:

      1. Build a `GhClient` via `createGhClient` from `gh-issues-client.ts`.
      2. Fetch the project's id and Status field via GraphQL:

         ```graphql
         query Project($owner: String!, $number: Int!) {
           organization(login: $owner) {
             projectV2(number: $number) {
               id
               title
               field(name: "Status") {
                 ... on ProjectV2SingleSelectField {
                   id
                   options { id name }
                 }
               }
             }
           }
           # also try `user(login: $owner)` if organization is null — see below
         }
         ```

         If `organization.projectV2` is null, retry with `user(login: $owner) { projectV2(number: $number) { ... } }`. This handles personal projects.

         If the project is found but its Status field is null, throw
         `Error("Project ${owner}/${number} has no Status field; gh-issues requires one.")`.

         If the project itself is not found, throw
         `Error("Project ${owner}/${number} not found or inaccessible.")`.

      3. Build a `StateMachineDef` from the Status options, in the project's
         display order:
         - `states` = option names (preserve order from response).
         - `initial` = first option name.
         - `events` = one per state: `{ [name]: { from: "*", to: name } }`. Any state
           can transition to any other state. No guards.

      4. Cache `{ projectId, statusFieldId, statusOptions: Map<name, optionId>,
         stateMachine }` for the session. The state machine is **frozen** at open
         time; do not refetch.

      5. Return a `TaskList` whose:
         - `lists()` resolves to `[`<owner>/<number>`]` (a single name).
         - `list(name)` accepts that exact name and any other name throws
           `Error("gh-issues backend has a single list <owner>/<number>")`.
         - `allTasks(filter)` delegates to `list(<owner>/<number>).all(filter)`.
         - `get(qualifiedId)` parses `<list>/<id>` and delegates.
         - `moveBetweenLists(qualifiedId, targetList)` throws the same single-list error.

         The returned `Tasks` exposes:
         - `name`, `stateMachine` (the derived one).
         - `all`, `get`, `create`, `update`, `fire`, `canFire`, `events`, `delete`,
           `move`, `reorder`. For this task, every method except `events`/`canFire`
           may throw `Error("not yet implemented")`. `events`/`canFire` use
           `eventsFromState` / `findEvent` from `state-machine.ts` against the cached
           state machine.

      Tests in `packages/task-list/src/backends/gh-issues.test.ts`:
      - On open, fetches the project Status field and builds a state machine whose
        `states` match the project's options in display order, `initial` = first
        option, and every event is `from: "*"` to its target state. Use a fetch mock
        that returns a fixed GraphQL response.
      - Throws when the project has no Status field (Status field returned as null).
      - Throws when the project is not found (organization + user both null).
      - Falls back from organization to user for personal projects.
      - `lists()` returns the single project name.
      - `list("wrong-name")` throws.
      - Snapshot the outgoing GraphQL query+variables for the project fetch (asserts
        the wire shape stays stable). Snapshot file colocated under `__snapshots__/`.

      Constraints:
      - No `child_process.spawn`.
      - Tests inject `fetch` via the deps; no live API.
      - Use `memfs` if any filesystem touches sneak in (none expected).
    status:
      implement: done
      test: done
      commit: done

  - id: gh-issues-read
    title: gh-issues read path — Tasks.all() and Tasks.get()
    prompt: |
      In `packages/task-list/src/backends/gh-issues.ts`, implement `Tasks.all(filter?)`
      and `Tasks.get(id)` for the gh-issues backend. The factory and state machine
      caching are already in place from the prior task.

      `all(filter?)`:

      1. GraphQL query for items in the project, paginated (cursor `after`), 100 per
         page, ordered by the project view's row order:

         ```graphql
         query Items($projectId: ID!, $after: String) {
           node(id: $projectId) {
             ... on ProjectV2 {
               items(first: 100, after: $after) {
                 nodes {
                   id              # projectItemId
                   content {
                     __typename
                     ... on Issue {
                       number
                       title
                       body
                       url
                       createdAt
                       labels(first: 50) { nodes { name } }
                       assignees(first: 20) { nodes { login } }
                       milestone { title }
                     }
                   }
                   fieldValueByName(name: "Status") {
                     ... on ProjectV2ItemFieldSingleSelectValue {
                       name
                     }
                   }
                 }
                 pageInfo { hasNextPage endCursor }
               }
             }
           }
         }
         ```

      2. Skip non-Issue content (drafts, PRs).

      3. Map each Issue item to a `Task`:

         ```ts
         {
           list: "<owner>/<number>",
           id: String(issue.number),
           qualifiedId: "<owner>/<number>/<id>",
           name: issue.title,
           description: issue.body ?? "",
           state: fieldValueByName.name ?? <initial state>,
           metadata: {
             url: issue.url,
             labels: issue.labels.nodes.map(n => n.name),
             assignees: issue.assignees.nodes.map(n => n.login),
             milestone: issue.milestone?.title ?? null,
             projectItemId: item.id,
             created: issue.createdAt,
           },
         }
         ```

         (The `created` lands in metadata so the existing `applyOrder("created")`
         from `utils.ts` works.)

      4. Apply `filter`:
         - `filter.state` — filter by Task.state.
         - `filter.includeArchived` — gh-issues has no "archived" concept; if the
           filter is set, return an empty list.
         - `filter.order`:
           - `"priority"` (default): keep project view order from the GraphQL response.
           - `"alphabetical"`: client-side sort by `qualifiedId` via `sortTasks` from `utils.ts`.
           - `"created"`: client-side sort via `applyOrder` against `metadata.created`.

      `get(id)`:

      1. Find the project item by issue number — single-item GraphQL query is fine
         (`repository.issue(number) { id title body ... projectItems(first: 10) { nodes { id project { id } fieldValueByName(...) } } }`).
         Throw `TaskNotFoundError` if the issue does not exist or has no item in
         this project.

      Tests:
      - `all()` returns project items in project view order from a fixture
        GraphQL response. Use one fixture covering: 1 page, multiple items,
        a non-Issue (draft) skipped, items with and without Status set.
      - `all({ order: "alphabetical" })` sorts by qualifiedId.
      - `all({ order: "created" })` sorts by `createdAt`.
      - `all({ state: "In progress" })` filters by Status name.
      - `all({ includeArchived: true })` returns empty.
      - Pagination: fixture with `hasNextPage: true` triggers a second query with
        the `endCursor`; both pages' items are merged in order.
      - `get("482")` returns the mapped task.
      - `get("999")` throws `TaskNotFoundError` when the issue exists but is not in
        this project.
      - Snapshot all outgoing GraphQL queries for these scenarios.

      Constraints:
      - No `child_process.spawn`.
      - Tests inject `fetch`; no live API.
    status:
      implement: done
      test: done
      commit: done

  - id: gh-issues-create-update-fire
    title: gh-issues write path — create, update, fire
    prompt: |
      In `packages/task-list/src/backends/gh-issues.ts`, implement `Tasks.create`,
      `Tasks.update`, and `Tasks.fire`.

      `create(input)`:

      1. `input.id` is **ignored** for gh-issues (the GH-assigned issue number
         becomes the id). Document this in a JSDoc comment on the implementation.
      2. GraphQL mutation `createIssue(input: { repositoryId, title, body })`. To get
         the `repositoryId`, fetch it lazily and cache: `repository(owner, name) { id }`.
      3. Mutation `addProjectV2ItemById(input: { projectId, contentId: <issueId> })`.
         Returns the `projectItem.id`.
      4. Mutation `updateProjectV2ItemFieldValue` setting the Status field to the
         **initial** state (cached from open). Use the singleSelect option id from
         the cached `statusOptions` map.
      5. Re-fetch the item via the same shape used in `get()` and return the mapped
         `Task`.

      `update(id, patch)`:

      1. Resolve the issue's node id by issue number. Cache `(number → issueId)` for
         the session if convenient, or look up each call.
      2. GraphQL mutation `updateIssue(input: { id, title?, body? })` for fields the
         caller passed.
      3. v1: ignore `patch.metadata` entirely (labels/assignees/milestone are
         read-only here). Document in code: "metadata writes are out of scope for v1
         on gh-issues."
      4. Return the re-fetched `Task`.

      `fire(id, event, opts?)`:

      1. The `event` name must equal a known state in the cached state machine. If
         not, throw `InvalidTransitionError`.
      2. Look up the option id for that state from the cached `statusOptions` map.
      3. Mutation `updateProjectV2ItemFieldValue` setting Status to that option id.
         The project item id is needed — fetch it via the issue's
         `projectItems(first: 10)` filtered by `project.id`.
      4. Ignore `opts.metadataPatch` for v1 (same reason as update).
      5. Return the re-fetched `Task`.

      Tests:
      - `create({ name, description })` issues the three-mutation sequence and
        returns a task whose state equals the initial state from the fetched
        Status options. Snapshot all outgoing mutations.
      - `create` ignores a passed `id` and uses the GH-assigned issue number.
      - `update("482", { name: "new" })` issues only `updateIssue` with `title`.
      - `update("482", { metadata: { labels: ["x"] } })` is a no-op (no mutation
        sent); document this in a test comment.
      - `fire("482", "<known-state>")` issues `updateProjectV2ItemFieldValue` with
        the right option id.
      - `fire("482", "<unknown>")` throws `InvalidTransitionError`.
      - Snapshot every outgoing GraphQL mutation+variables.

      Constraints:
      - No `child_process.spawn`.
      - Tests inject `fetch`; no live API.
      - State machine override (`OpenTaskListOptions.stateMachine`) does not apply
        to gh-issues; if a caller passed one, ignore it (documented in plan 5c).
    status:
      implement: done
      test: done
      commit: done

  - id: gh-issues-reorder-delete
    title: gh-issues reorder + delete — move, reorder, delete
    prompt: |
      In `packages/task-list/src/backends/gh-issues.ts`, implement `Tasks.move`,
      `Tasks.reorder`, and `Tasks.delete`.

      `move(id, anchor)`:

      1. Resolve the project item id for `id` and the anchor's project item id
         (look up the anchor by issue number, same as `id`).
      2. GraphQL mutation `updateProjectV2ItemPosition(input: { projectId, itemId,
         afterId })`:
         - `{ before: x }` → `afterId = <item before x's projectItemId>` (find x's
           predecessor in the current ordering, or `null` to put at top).
         - `{ after: x }` → `afterId = x's projectItemId`.
         - `{ position: "top" }` → `afterId = null`.
         - `{ position: "bottom" }` → `afterId = <last item's projectItemId>`.
      3. If the anchor id (for `before`/`after`) is missing, throw
         `AnchorNotFoundError`.
      4. Return the re-fetched task.

      `reorder(ids)`:

      1. Validate set equality vs the current active items in the project
         (active = present in the project; gh-issues has no "archived" notion).
         If the input is missing items or contains unknown ids, throw
         `OrderMismatchError({ missing, extra })`.
      2. Issue `updateProjectV2ItemPosition` mutations sequentially: first id with
         `afterId = null` (top), then each subsequent id with the previous id's
         projectItemId. n round-trips, no batch primitive available.
      3. Return the re-fetched tasks in the new order.

      `delete(id)`:

      1. Resolve the project item id by issue number.
      2. GraphQL mutation `deleteProjectV2Item(input: { projectId, itemId })`. The
         issue stays in the repo (not closed).
      3. Throw `TaskNotFoundError` if the issue is not in this project.

      Tests:
      - `move("482", { before: "100" })` issues the right `updateProjectV2ItemPosition`
        with the predecessor's item id as `afterId`. Snapshot the mutation.
      - `move("482", { after: "100" })` uses 100's item id as `afterId`.
      - `move("482", { position: "top" })` uses `null`.
      - `move("482", { position: "bottom" })` uses the last item's id.
      - `move("482", { before: "missing" })` throws `AnchorNotFoundError`.
      - `reorder(["100", "200", "482"])` issues 3 sequential position mutations,
        snapshotted in order.
      - `reorder(["100", "200"])` (missing 482) throws `OrderMismatchError`.
      - `reorder(["100", "200", "482", "999"])` (extra 999) throws
        `OrderMismatchError`.
      - `delete("482")` issues `deleteProjectV2Item` and snapshots it.
      - `delete("999")` (issue not in project) throws `TaskNotFoundError`.

      Constraints:
      - No `child_process.spawn`.
      - Tests inject `fetch`; no live API.
    status:
      implement: done
      test: done
      commit: open

  - id: gh-issues-wire
    title: Wire gh-issues into open() + README
    prompt: |
      Final wiring task.

      1. In `packages/task-list/src/open.ts`, dispatch on
         `options.type === "gh-issues"`. Resolve auth + endpoint, then call
         `ghIssuesBackend({ repo, project, defaults, token, endpoint, fetch })`.

         Auth resolution lives in `gh-issues-client.ts` (`resolveAuth` /
         `resolveEndpoint`); `open.ts` is the only place in the package that calls
         them. No `if/case` outside of `open.ts`.

      2. Update `packages/task-list/src/index.ts` exports if anything new from the
         backend or client should be public (likely just types, not functions).

      3. Update `packages/task-list/README.md`:
         - Add a `gh-issues` row to the backends table.
         - Add a `gh-issues` usage example mirroring the `markdown-dir` /
           `yaml-file` examples. Show: open with `repo` + `project`, list
           singleton-name behavior, `create` ignoring `id`, `fire(state)` writing
           Status, `move` reordering project items.
         - Document limitations: state machine is fetched at open and frozen for
           the session (re-open to refresh); `archived` is not supported (returns
           empty); `update` does not write labels/assignees/milestone in v1;
           `moveBetweenLists` is unsupported on gh-issues; `id` on `TaskCreate` is
           ignored on this backend; `gh auth token` must be available, or pass
           `auth: { token }`.
         - Add `GH_HOST` to the env vars section of the README ("Defers to gh CLI's
           host configuration; set GH_HOST to override.").

      4. Run `npm test` from the package and confirm the existing 114 tests still
         pass plus all new gh-issues tests are green.

      Constraints:
      - No additions to README beyond what is listed (per CLAUDE.md "you are not
        allowed to add anything to readme without user's permission" — this task
        IS the user's permission, scoped to the items above).
      - No new top-level CLI commands or SDK changes.
    status:
      implement: open
      test: open
      commit: open
---

# Context

This pipeline implements steps 5–7 of the design doc that previously lived in this file. Steps 1–4 (ordering API surface, yaml-file ordering, markdown-dir filename-prefix ordering, `moveBetweenLists` for both file backends) are already merged.

## Settled design (for the executor)

**Backend shape.** `gh-issues` is a thin wrapper over a single (repo, project) pair. One project's items show as one list of tasks. The project's `Status` field supplies the state machine.

**Mapping.**

| `task-list` concept | GitHub mapping |
| --- | --- |
| backend instance | one repo + one project |
| `lists()` | single name: `<owner>/<number>` (the project itself) |
| `id` | issue number as a string (`"482"`) |
| `name` | issue title |
| `description` | issue body |
| `state` | current value of the project's Status field for this item |
| `metadata` | `{ url, labels, assignees, milestone, projectItemId, created }` |
| priority order | the project view's row order (read via the items connection) |

**State machine.** Fetched at `openTaskList`; states = Status field option names in display order; initial = first option; events = one per state, `from: "*"`, allowing any → any. Frozen for the session — re-open to refresh. `stateMachine` in `OpenTaskListOptions` is not accepted on this backend.

**Auth.** `auth: { token }` if passed; otherwise `gh auth token` via `@poe-code/process-runner`. Not parsing `~/.config/gh/hosts.yml`. `GH_HOST` honored for enterprise.

**Operation table.**

| `Tasks` method | GH mutation |
| --- | --- |
| `create({ name, description })` | `createIssue` → `addProjectV2ItemById` → `updateProjectV2ItemFieldValue` to initial Status. `id` on input is ignored. |
| `update(id, patch)` | `updateIssue` for title/body. Metadata is read-only in v1. |
| `fire(id, event)` | `updateProjectV2ItemFieldValue` to the target Status option. |
| `delete(id)` | `deleteProjectV2Item` (issue stays in repo, not closed). |
| `move(id, anchor)` | `updateProjectV2ItemPosition`. |
| `reorder(ids)` | n sequential `updateProjectV2ItemPosition` calls. |
| `all({ order })` | `priority` = project view order; `alphabetical` = client-side; `created` = client-side via `metadata.created` (`createdAt`). |

**Out of scope (v1).** Updating Status field options themselves (project schema mutation). Closing/reopening issues. OAuth flows. GitHub App auth. Multi-host failover. Cross-project reattach.

**Tests.** Mock `fetch` in deps; snapshot outgoing GraphQL queries+variables to lock the wire shape. No live API. Bypass `gh auth token` by passing `auth: { token: "test-token" }`.

## Order of execution

Tasks above are listed in dependency order. Run them sequentially. The wiring task at the end pulls everything together and runs the full test suite.
