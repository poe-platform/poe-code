---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: sync-module-skeleton
    title: Create gh-issues-sync skeleton with public types
    prompt: |
      Create `packages/task-list/src/backends/gh-issues-sync.ts` containing the
      public types and function stubs only (no implementation yet):

      - `VerifyGhProjectOptions { owner: string; number: number; requiredStates: readonly string[]; client?: GhClient; fetch?: typeof fetch; auth?: { token: string } }`
      - `VerifyGhProjectReport { ok: boolean; project: { id: string; number: number; owner: string } | null; statusField: { id: string; options: readonly string[] } | null; missingProject: boolean; missingStatusField: boolean; missingOptions: readonly string[] }`
      - `SyncGhProjectOptions extends VerifyGhProjectOptions { title?: string; yes?: boolean }`
      - `SyncGhProjectReport extends VerifyGhProjectReport { created: readonly string[]; updated: readonly string[] }`
      - `class GhProjectSyncError extends Error` with readonly `op: "lookup" | "createProject" | "createField" | "createOption"` and `target: string`, constructor accepting `{ op, target, cause?, message }`.
      - `export function verifyGhProject(opts): Promise<VerifyGhProjectReport>` — body throws `new GhProjectSyncError({ op: "lookup", target: "verifyGhProject", message: "not_implemented" })`.
      - `export function syncGhProject(opts): Promise<SyncGhProjectReport>` — same stub pattern.

      Re-export all five symbols (`verifyGhProject`, `syncGhProject`, `VerifyGhProjectReport`, `SyncGhProjectReport`, `GhProjectSyncError`) plus the option interfaces from `packages/task-list/src/index.ts`.

      Before writing the file, read `packages/task-list/src/backends/gh-issues-client.ts` and `packages/task-list/src/backends/gh-issues.ts` so the new types reference the existing `GhClient`. Do not modify `gh-issues.ts`. `npm run build` must pass after this step.
    status:
      implement: done
      commit: open

  - id: verify-gh-project
    title: Implement verifyGhProject with read-only project/field/option checks
    prompt: |
      Implement `verifyGhProject` in `packages/task-list/src/backends/gh-issues-sync.ts`.

      Behavior:
      - Resolve a `GhClient` from `opts.client`, or build one from `opts.fetch` + `opts.auth.token`. If no token is available, throw `GhProjectSyncError({ op: "lookup", target: "auth", message: "missing_auth" })`.
      - Run the same organization/user project query already used by `gh-issues.ts` (reuse the existing constants — do not add a second query). Treat 5xx / network errors as `GhProjectSyncError op=lookup target="project:<owner>/<number>"`.
      - If the project does not exist, return `{ ok: false, project: null, statusField: null, missingProject: true, missingStatusField: true, missingOptions: opts.requiredStates }`.
      - If multiple single-select fields with name `Status` exist, pick the one named exactly `Status`. Field-name comparison is case-sensitive: `status` is treated as missing.
      - If the `Status` field is missing, return `{ ok: false, project: {...}, statusField: null, missingProject: false, missingStatusField: true, missingOptions: opts.requiredStates }`.
      - Option-name comparison is case-sensitive: existing `Done` does not satisfy required `done`. Compute `missingOptions` as `requiredStates` minus the field's option names.
      - `ok = !missingProject && !missingStatusField && missingOptions.length === 0`.

      Add `packages/task-list/src/backends/gh-issues-sync-verify.spec.ts` using the `MockGhClient` / fetch-mock helpers from `packages/task-list/src/backends/test-helpers.ts`. Cover: project missing → `missingProject=true` and `ok=false`; field missing → `missingStatusField=true`; some options missing → listed in `missingOptions`; everything present → `ok=true`; field name `status` (lowercase) → treated as missing; option name `Done` vs required `done` → treated as missing; missing `gh auth token` → typed `GhProjectSyncError op=lookup target=auth`.

      Do not mock real network. All GraphQL goes through `GhClient.request`.
    status:
      implement: open
      test: open
      commit: open

  - id: sync-gh-project-mutations
    title: Implement syncGhProject with create-only GraphQL mutations
    prompt: |
      Implement `syncGhProject` in `packages/task-list/src/backends/gh-issues-sync.ts`. It must call the verify path first and then issue only the mutations required to converge.

      Mutations and inputs:
      - `createProjectV2` — when the project is missing. Look up `ownerId` via `organization(login: $owner) { id }`, falling back to `user(login: $owner) { id }`. Title defaults to `opts.title ?? \`${owner}/${number}\``. On success record `"project"` in `created` and learn the assigned number from the response.
      - `createProjectV2Field` — when the `Status` field is missing entirely. Input `{ projectId, dataType: SINGLE_SELECT, name: "Status", singleSelectOptions: opts.requiredStates.map(name => ({ name, color: "GRAY" })) }`. Records `"field"` in `created`; do not also emit per-option entries on this path.
      - `createProjectV2SingleSelectFieldOption` — only when the field already exists. One call per `missingOptions` entry with `{ fieldId, name, color: "GRAY" }`. Records `"option:<name>"` per call.

      Idempotency and error rules:
      - Never delete or rename anything. `updated` is always `[]` in v1.
      - If everything is present already, return immediately with empty `created`.
      - Each mutation is wrapped in try/catch that converts GraphQL errors into `GhProjectSyncError` with the matching `op` (`createProject`, `createField`, `createOption`) and `target` (project owner/number, field name, option name). Preserve the GitHub error message.
      - Project lookup is reused from the verify step. If a project was just created, return a report whose `project` reflects the *new* id and number, and whose `statusField` and `missingOptions` reflect the post-mutation state.

      Add `packages/task-list/src/backends/gh-issues-sync-create.spec.ts` proving: missing project → `createProjectV2` invoked with the resolved owner id; missing field with project present → `createProjectV2Field` invoked once with every required option seeded; partial options missing → exactly one `createProjectV2SingleSelectFieldOption` per missing option, no field-create call; the returned report lists what was created in the documented order.
    status:
      implement: open
      test: open
      commit: open

  - id: sync-idempotency-and-error-specs
    title: Add idempotency and error-mapping specs for syncGhProject
    prompt: |
      Add two specs in `packages/task-list/src/backends/`:

      `gh-issues-sync-idempotent.spec.ts`:
      - Run `syncGhProject` twice in sequence against a `MockGhClient` whose state advances as mutations succeed. The first run creates everything; the second run must issue zero mutations and return `created=[]`, `ok=true`, `missingOptions=[]`.
      - Network failure mid-sync: simulate a mutation that succeeds for the field create but rejects on one of the option creates. After the failure, re-running sync must complete the remaining option creates without re-issuing the field create.

      `gh-issues-sync-errors.spec.ts`:
      - Missing `gh auth token` → both `verifyGhProject` and `syncGhProject` throw `GhProjectSyncError op=lookup target=auth`.
      - Project lookup 5xx → `GhProjectSyncError op=lookup target=project:<owner>/<number>` with the original error attached as `cause`.
      - `createProjectV2` rejection (e.g. permission denied) → `GhProjectSyncError op=createProject` with the GitHub message preserved in `.message`.
      - `createProjectV2Field` rejection → `GhProjectSyncError op=createField target=Status`.
      - `createProjectV2SingleSelectFieldOption` rejection → `GhProjectSyncError op=createOption target=<option name>`.

      All assertions go through `MockGhClient`/fetch mocks — no real network.
    status:
      implement: open
      test: open
      commit: open

  - id: tasks-options-resolver
    title: Build shared CLI options + WORKFLOW.md frontmatter resolver
    prompt: |
      Create `src/cli/commands/tasks-options.ts` exporting a `resolveTasksOptions` function that produces `{ owner: string; number: number; requiredStates: string[]; repo?: string; workflowPath: string }` from:

      Flag inputs (commander option object):
        --workflow <path>   default "./WORKFLOW.md"
        --repo <owner/name>
        --project <owner/number>
        --states <csv>

      Positional `<list>` argument as `"<owner>/<number>"`.

      Resolution rules:
      1. Parse `<list>` and `--project` as `owner/number`; `--project` wins if both supplied.
      2. Read the `WORKFLOW.md` at `--workflow` (must exist; if not, throw a `TasksOptionsError` with `code: "missing_workflow"`). Parse YAML frontmatter using the project's existing frontmatter parser (look in `src/` for the helper used by other commands; do not add a new YAML dep).
      3. `requiredStates` resolution order:
         a. `--states` CSV when present.
         b. Union of `active_states` and `terminal_states` from the `maestro` block in WORKFLOW.md frontmatter.
         c. If the frontmatter references `maestroTaskStateMachine`, expand to `["queued", "agent-running", "human-review", "done", "failed", "archived"]`.
         d. Otherwise throw `TasksOptionsError code=missing_required_states`.
      4. `repo` is read from `tasks.repo` in frontmatter and overridden by `--repo`.

      Add unit tests as `src/cli/commands/tasks-options.test.ts` using `memfs` for WORKFLOW.md fixtures. Cover: `--states` overrides frontmatter; frontmatter active+terminal union path; `maestroTaskStateMachine` expansion; `--project` overrides `<list>`; missing WORKFLOW.md throws `missing_workflow`; no states from any source throws `missing_required_states`.

      Do not add regex parsing for YAML or frontmatter — use the existing parser. Do not introduce zod.
    status:
      implement: open
      test: open
      commit: open

  - id: tasks-cli-command
    title: Register `poe-code tasks verify` and `tasks sync` subcommands
    prompt: |
      Create `src/cli/commands/tasks.ts` exporting `registerTasksCommand(program: Command, container: CliContainer): void`. It defines a `tasks` parent command with two subcommands.

      `tasks verify <list> [options]`:
        --workflow <path>          default "./WORKFLOW.md"
        --repo <owner/name>
        --project <owner/number>
        --states <csv>
        --json

      Behavior: calls `resolveTasksOptions` (from `tasks-options.ts`), then `verifyGhProject`. Prints `[info]` / `[warn]` / `[error]` lines via the project's existing design-system logger (do not import `chalk` directly). On `ok=false`, exit non-zero. With `--json`, print the `VerifyGhProjectReport` as a single JSON object to stdout and skip the human log lines.

      `tasks sync <list> [options]`:
        --workflow, --repo, --project, --states, --json
        --yes  (required for non-interactive runs; without it and not in a TTY, refuse with a clear message)

      Behavior: calls `resolveTasksOptions` then `syncGhProject`. When the project is missing and gets created, print the new project number prominently with an instruction to update WORKFLOW.md manually (v1 does not write back to the file). On `--json`, print the `SyncGhProjectReport` and skip log lines. On `GhProjectSyncError`, print a one-line error and exit non-zero with the `op` and `target` in the message.

      Wire the command from `src/cli/program.ts` by calling `registerTasksCommand(program, container)` alongside the other commands.

      Add `src/cli/commands/tasks-command.test.ts` covering: `verify` exits 0 when report is `ok`, non-zero when not; `sync` passes the merged frontmatter+flags to the SDK call (assert via a stubbed `syncGhProject`); `--json` output exactly matches `VerifyGhProjectReport` / `SyncGhProjectReport` shapes; `--workflow` falls back to `./WORKFLOW.md`; `--states` overrides frontmatter. Mock the SDK functions at the import boundary; do not exercise the GraphQL layer here.
    status:
      implement: open
      test: open
      commit: open

  - id: document-tasks-commands
    title: Document verify/sync in the task-list README
    prompt: |
      Update `packages/task-list/README.md` only (do not touch the root README without explicit user permission). Add a "Verifying and provisioning the GitHub Project v2 board" section covering:

      - The two SDK functions `verifyGhProject` and `syncGhProject`, their option shapes, and the `VerifyGhProjectReport` / `SyncGhProjectReport` return types.
      - The two CLI commands `poe-code tasks verify <list>` and `poe-code tasks sync <list>` with the full option list (`--workflow`, `--repo`, `--project`, `--states`, `--json`, `--yes`).
      - Case-sensitivity caveat: `Status` field name and option names are matched case-sensitively; `status` or `Done` are treated as missing.
      - The v1 behavior when sync creates a new project: the new number is printed and the operator must update `WORKFLOW.md` by hand.
      - Prerequisite removed: `openTaskList({ type: "gh-issues" })` no longer requires manual board setup if `tasks sync` was run first.

      Do not add new env-var documentation; this feature introduces no new env vars.
    status:
      implement: open
      commit: open
---

# Tasks board verify and sync

Two new CLI commands and matching `@poe-code/task-list` exports to verify and idempotently provision the GitHub Project v2 board required by the `gh-issues` backend.

## 1. What we're building

Today `openTaskList({ type: "gh-issues" })` throws if the GitHub Project v2 doesn't exist, has no `Status` field, or has wrong options ([gh-issues.ts:359-368](packages/task-list/src/backends/gh-issues.ts#L359-L368)). Operators have to set the board up by hand. This plan adds two operations:

- **`poe-code tasks verify <list>`** — read-only preflight. Confirms the project exists, has a `Status` single-select field, and has all options required by the configured state machine. Exits non-zero with a precise reason if not.
- **`poe-code tasks sync <list>`** — idempotent converge. Creates the project if missing, the `Status` field if missing, and any missing options. Never deletes or renames anything. Safe to re-run.

Both commands consume the same `tasks:` block in `WORKFLOW.md` (or accept inline flags) so an operator can prepare the board in one step before running `poe-code maestro`.

### Non-goals (v1)

- Renaming or deleting existing options/fields (sync is additive only).
- Migrating issues between projects.
- Backfilling existing repo issues into the project.
- Non-`gh-issues` backends — `markdown-dir` already has `create: true`; `yaml-file` already has `create: true`; neither needs verify/sync.
- Org permissions / auth setup (out of scope; defer to `gh auth login`).

## 2. User-facing shape

### CLI

```text
$ poe-code tasks verify <list> [options]
$ poe-code tasks sync   <list> [options]

Arguments:
  list                       Qualified list name, e.g. "octo-org/7"

Options:
  --workflow <path>          Read tasks config from this WORKFLOW.md (default: ./WORKFLOW.md)
  --repo <owner/name>        Override tasks.repo
  --project <owner/number>   Override tasks.project (e.g. "octo-org/7")
  --states <comma-list>      Required Status options (default: read from active+terminal states)
  --json                     Machine-readable output
  --yes                      Non-interactive; sync proceeds without prompting
```

### Examples

```text
$ poe-code tasks verify octo-org/7
[info] project octo-org/7 exists
[info] Status field present id=PVTSSF_lQHO...
[warn] missing Status options: human-review, failed
[error] verify failed: 2 missing Status options
exit 1

$ poe-code tasks sync octo-org/7 --yes
[info] project octo-org/7 exists
[info] Status field present
[info] creating Status option "human-review" ...ok
[info] creating Status option "failed" ...ok
[info] sync complete: 0 created, 2 updated

$ poe-code tasks verify octo-org/7 --json
{
  "ok": true,
  "project": { "id": "PVT_...", "number": 7, "owner": "octo-org" },
  "statusField": { "id": "PVTSSF_...", "options": ["queued", "agent-running", "human-review", "done", "failed", "archived"] },
  "missingOptions": []
}

$ poe-code tasks sync         # bootstrap a brand-new board
[info] WORKFLOW.md → tasks.project=octo-org/7 not found
[info] creating Project v2 "octo-org/7" ...ok number=7
[info] creating Status field ...ok
[info] creating Status option "queued" ...ok
[info] creating Status option "agent-running" ...ok
[info] creating Status option "human-review" ...ok
[info] creating Status option "done" ...ok
[info] creating Status option "failed" ...ok
[info] creating Status option "archived" ...ok
[info] sync complete: 7 created, 0 updated
```

### SDK

```ts
import { verifyGhProject, syncGhProject } from "@poe-code/task-list";

const report = await verifyGhProject({
  owner: "octo-org",
  number: 7,
  requiredStates: ["queued", "agent-running", "human-review", "done", "failed", "archived"],
});
// report: { ok: boolean; project: ProjectMeta | null; statusField: StatusFieldMeta | null; missingProject: boolean; missingStatusField: boolean; missingOptions: string[] }

if (!report.ok) {
  await syncGhProject({
    owner: "octo-org",
    number: 7,         // when missing, sync creates the project and learns the assigned number
    title: "octo-org/7",
    requiredStates: ["queued", "agent-running", "human-review", "done", "failed", "archived"],
  });
}
```

`verifyGhProject` is pure read. `syncGhProject` issues only the GraphQL mutations strictly needed to converge: `createProjectV2` (if missing), `createProjectV2Field` (if Status missing), `createProjectV2SingleSelectFieldOption` (per missing option). It returns a `SyncReport` listing what changed.

## 3. Implementation details and technical decisions

### Where it lives

- Logic: `packages/task-list/src/backends/gh-issues-sync.ts` (new file). Re-uses `GhClient` from `gh-issues-client.ts`. No changes to the existing `gh-issues.ts` runtime.
- CLI: `src/cli/commands/tasks.ts` (new file). Wires `registerTasksCommand(program, container)` alongside the existing `auth`, `pipeline`, etc. commands.
- Shared option reader: `src/cli/commands/tasks-options.ts` — parses `--workflow`, `--repo`, `--project`, `--states`, merges with frontmatter. Reused by both `verify` and `sync`.

### GraphQL surface

`verifyGhProject` runs the same `PROJECT_ORGANIZATION_QUERY` / `PROJECT_USER_QUERY` already used by `gh-issues.ts`. No new read queries.

`syncGhProject` issues:

- `createProjectV2` — input `{ ownerId, title }`. Owner id is fetched via a small `organization(login)` / `user(login)` lookup first.
- `createProjectV2Field` — input `{ projectId, dataType: SINGLE_SELECT, name: "Status", singleSelectOptions: [...] }`. Only used when the Status field is missing entirely; in that case all required options are seeded in one call.
- `createProjectV2SingleSelectFieldOption` — input `{ fieldId, name, color: GRAY }`. Used per missing option when the field already exists.

Each mutation is wrapped in a try/catch that converts GraphQL errors into a typed `GhProjectSyncError` with `op: "createProject" | "createField" | "createOption"` and `target`.

### Required state list

Both commands need a list of Status options to check or create. Resolution order:

1. `--states <comma-list>` flag (CSV).
2. From the `WORKFLOW.md` frontmatter: union of `active_states` and `terminal_states` from the maestro config. This is the common path — the operator's WORKFLOW.md is the source of truth.
3. From a custom state machine: if `WORKFLOW.md` references the recommended `maestroTaskStateMachine`, expand it to `["queued", "agent-running", "human-review", "done", "failed", "archived"]`.

If none of the above resolves, fail with `missing_required_states`.

### Idempotency rules

- `sync` never deletes or renames.
- `sync` never re-creates a project; if the configured `tasks.project.number` already exists, that's a hit and the project is reused.
- If the configured project number doesn't exist, sync creates it and prints the new number; operator updates WORKFLOW.md manually. No file-edit logic in v1.

### Edge cases

- `gh auth token` missing → both commands fail with `missing_auth`, recommend `gh auth login`.
- User is not an org member with project-create permission → `createProjectV2` GraphQL error surfaces as `GhProjectSyncError op=createProject reason=<github message>`. No retry.
- Status field exists with a different name capitalization (e.g. `status` vs `Status`) → treat as missing (GitHub is case-sensitive on field names).
- Status option name collisions (e.g. existing `Done` vs required `done`) → treat as missing. Sync creates the case-exact variant.
- Multiple Status fields exist (operator added another single-select with the same name elsewhere) → use the one named exactly `Status`, ignore others.
- Network failure mid-sync → safe to re-run; idempotency holds.

## 4. Interfaces

See the per-task prompts above for the canonical type signatures, CLI surface, and test coverage requirements. The SDK is exported from `packages/task-list/src/index.ts`.

## 5. v2 follow-ups

- `--write-back` to update `WORKFLOW.md`'s `tasks.project.number` when sync creates a new project.
- `tasks sync` for non-gh-issues backends (`markdown-dir`, `yaml-file`).
- Pruning unused Status options (with `--prune` and a confirmation).
- Backfilling existing repo issues into the project.
- Validate option colors (currently we always create with `GRAY`).
