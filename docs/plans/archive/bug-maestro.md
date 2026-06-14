---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: multi-workflow-resolve
    title: Resolve maestro workflows by name
    prompt: |
      Teach the maestro entrypoints to accept `--name <id>` in addition to
      `--config <path>` so a project can host multiple workflow files.

      Resolution rule: `--name <id>` resolves to `<ID-UPPERCASED>.WORKFLOW.md`
      at the repo root (id `bugs` → `BUGS.WORKFLOW.md`). The literal id
      `default` resolves to `WORKFLOW.md`. `--config <path>` always wins
      when supplied; passing both is an error. Missing resolved file is an
      error with a clear message.

      Touch:
      - packages/maestro/src/index.ts: runMaestro accepts `name?: string`;
        add `resolveWorkflowPath(name, cwd)` next to the existing
        `workflowPath` handling.
      - packages/maestro/src/tick-command.ts: runMaestroTick accepts
        `name?: string` and uses the same resolver.
      - packages/maestro-tui/src/run.ts: runMaestroTui accepts `name?: string`
        the same way.
      - src/cli/program.ts: add `--name <id>` flag to `maestro run`,
        `maestro tick`, `maestro tui`. Pass through to the SDK. SDK and CLI
        must stay in parity (CLAUDE.md).

      Tests with memfs, no live filesystem. Cover: --name default →
      WORKFLOW.md, --name bugs → BUGS.WORKFLOW.md, both supplied → error,
      missing file → error.
    status:
      implement: done
      test: done
      commit: done
  - id: gh-issues-state-via-labels
    title: State-via-labels mode in gh-issues backend
    prompt: |
      Audit packages/task-list/src/* to confirm how the gh-issues backend
      stores task state today (labels, project v2 columns, or metadata).
      Then ensure state can be driven by issue labels.

      Add an opt-in `state.labelPrefix` option to the gh-issues backend
      config (default unset = current behavior, no breakage). When set,
      the backend reads state from the first label that starts with the
      prefix and writes state transitions by adding `<prefix><newState>`
      and removing any other `<prefix>*` labels on the same issue. Closing
      / reopening the issue is independent of state — labels are the
      source of truth.

      Keep all existing behavior when `labelPrefix` is omitted. Extend the
      backend, do not duplicate it (CLAUDE.md memory: extend-not-duplicate).

      Tests use a fake fetch — no live GitHub calls. Cover: read state from
      labels, write transition adds/removes correctly, multiple status:*
      labels on one issue resolve deterministically (first declared state
      wins), and labelPrefix unset preserves prior behavior.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: move-tasks-sdk
    title: moveTasks transfer API in @poe-code/task-list
    prompt: >
      Add a `moveTasks` function to @poe-code/task-list that transfers tasks

      from one configured backend to another. Generic — bug import is one

      caller; future provider migrations reuse the same function.


      Public API:
        moveTasks(opts: {
          source: TaskListOptions;
          target: TaskListOptions;
          deleteSource?: boolean;
          limit?: number;
          rate?: number;                            // creations per minute, default 15
          dryRun?: boolean;
          stateMap?: Record<string, string>;
          onProgress?: (event: MoveProgressEvent) => void;
        }): Promise<MoveResult>

        MoveResult = { created: number; skipped: number; errors: Array<{ id: string; error: string }> }

      Per task: read { name, description, state, metadata } from source,

      create equivalent in target (state via stateMap; falls back to target

      initial state if unmapped), then delete from source iff

      `deleteSource` and the target create resolved successfully. Atomic

      per-task — partial failures leave source intact so re-runs are

      idempotent.


      Throttle creations to `rate` per minute regardless of backend. Use

      a simple token bucket; honor `dryRun` (emit progress events only,

      no writes). Errors accumulate, never abort the run.


      Tests:

      - memfs markdown-dir → markdown-dir: state mapping, dryRun.

      - fake-fetch markdown-dir → gh-issues: target uses
        gh-issues-state-via-labels mode added in the prior task.
      - vi.useFakeTimers for throttle timing assertions.

      - One source task that fails on target.create: result.errors has it,
        source file remains, run continues.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: move-tasks-cli
    title: poe-code tasks move CLI
    prompt: |
      Add `poe-code tasks move` as the CLI surface for the SDK `moveTasks`.
      Mirror the SDK flags so CLI and SDK stay in parity (CLAUDE.md).

      Shape:
        poe-code tasks move --from <workflow.md> --to <workflow.md>
                            [--delete-source] [--rate N] [--limit N]
                            [--dry-run] [--state-map a:b,c:d]

      Both --from and --to are paths to a WORKFLOW.md (or any markdown
      file with a `tasks:` frontmatter block). The command loads only the
      `tasks:` block from each via the existing workflow loader; states
      and other workflow config are ignored.

      Implementation lives in src/cli/program.ts as a thin wrapper around
      moveTasks from @poe-code/task-list. Parse --state-map with a
      strict `key:value,key:value` parser that rejects malformed input.

      Tests in src/cli/ with moveTasks mocked: flag parsing, missing
      --from or --to errors clearly, --state-map parser handles trailing
      commas and rejects empty keys/values.
    status:
      implement: done
      test: done
      commit: done
  - id: bugs-workflow-file
    title: Write BUGS.WORKFLOW.md
    prompt: |
      Add `BUGS.WORKFLOW.md` at the repo root. Mirror the structure of the
      existing `WORKFLOW.md` (read it first) but with these differences:

      - tasks: type gh-issues, repo poe-platform/poe-code, filter
        label:bug, state.labelPrefix `status:` (the mode added in the
        gh-issues-state-via-labels task), auth.token `$MAESTRO_GH_TOKEN`.
      - agent.list: `poe-platform/poe-code`, agent.service: codex,
        max_concurrent_agents: 1.
      - polling.interval_ms: 30000.
      - workspace.root: `./.poe-code/maestro/bugs-workspaces`.
      - states (declaration order matters — that's the happy path):
          draft     (agent: claude) — short prompt: triage and dedup
                    against open issues with label:bug; on duplicate,
                    comment with the link and set state to wontfix;
                    otherwise refine title, confirm reproducibility,
                    advance with `poe-code tasks next`.
          confirmed — short prompt: scope the fix, label severity
                    (sev:1|2|3), identify the package/area, advance.
          fix       — short prompt: implement the fix, write a test that
                    fails before and passes after, open a PR linking the
                    issue, advance on merge.
          released: terminal true.
          wontfix:  terminal true.

      State prompts must be 1-3 lines, use the maestro template
      variables that WORKFLOW.md already uses (task.qualifiedId, task.url,
      task.id), no restating CLAUDE.md (memory:
      feedback_superintendent_prompts, feedback_dense_prompts).

      No code beyond writing the markdown file. Verify with:
        poe-code maestro run --name bugs --dry-run
      The dry-run must load the workflow without errors.
    status:
      implement: done
      commit: done
  - id: wire-and-screenshot
    title: End-to-end subset verification with screenshot
    prompt: >
      Verify the bugs maestro pipeline end-to-end on a small subset (do

      not drain production docs/bugs/ yet).


      Steps:
        1. Create a temporary BUGS-IMPORT.WORKFLOW.md at the repo root
           with the markdown-dir backend pointing at a fresh fixture
           directory containing 5 copied bug files from docs/bugs/.
        2. Dry-run the move:
             poe-code tasks move --from BUGS-IMPORT.WORKFLOW.md \
                                 --to BUGS.WORKFLOW.md --limit 5 --rate 15 --dry-run
           Confirm the output lists 5 planned creations with the expected
           titles.
        3. Drop --dry-run; run for real. Expect 5 GitHub issues with
           label:bug and status:draft, and 5 source files deleted.
        4. Launch the TUI:
             poe-code maestro tui --name bugs
           Capture a screenshot with the existing tooling:
             npm run screenshot-poe-code -- maestro tui --name bugs
        5. Delete BUGS-IMPORT.WORKFLOW.md and the fixture directory. Do
           NOT commit them.

      Only the screenshot file is a real deliverable; everything else is

      a smoke test. Production drain of docs/bugs/ is a separate ops

      step, tracked in the # Context section of this plan and run by

      hand after merge.
    status:
      implement: done
      commit: done
name: bug-maestro
state: archived
---

# Context

## What we're building

Bug intake on poe-code moves off the local `docs/bugs/` markdown directory
and onto GitHub issues with `label:bug`. Maestro drives the bug lifecycle
(`draft → confirmed → fix → released`, plus terminal `wontfix`) entirely
against the gh-issues backend.

## Decisions

- **GitHub is source of truth.** `docs/bugs/` becomes a transient staging
  area drained by `tasks move`. After the drain it is empty and can be
  deleted from the repo.
- **State on issues is labels.** `status:draft`, `status:confirmed`,
  `status:fix`, `status:released`, `status:wontfix`. Closing the issue is
  not the state signal; the label is. This works without a GitHub
  Projects v2 setup; projects integration stays available but optional.
- **Multiple maestro workflows per project.** Resolved by `--name <id>`
  → `<ID>.WORKFLOW.md` at the repo root. `WORKFLOW.md` is the default.
- **`moveTasks` is a generic provider transfer**, not a bug-specific
  importer. Lives in `@poe-code/task-list`. Bug import is one application.
- **Autoresolver gating already shipped** (commit `076a7e94`): the
  `github-issue-opened` workflow only runs when an `agent` label is
  applied. The bug-import wave (label:bug only) will not spawn agents.

## Drain ops checklist (post-merge, manual)

After the pipeline tasks land on main:

1. `poe-code tasks move --from BUGS-IMPORT.WORKFLOW.md --to BUGS.WORKFLOW.md --dry-run`
   — confirm the planned set matches what's in `docs/bugs/`.
2. `--limit 50 --rate 15` — validate the first batch in production.
3. Unbounded run. ~100 min wall-clock at 15 issues/min for 1470 files.
4. Commit deletions in batches (`git rm docs/bugs/<batch>`) so history
   shows the drain rather than a single 1470-file delete.
5. Once `docs/bugs/` is empty: delete the directory, delete
   `BUGS-IMPORT.WORKFLOW.md`, and remove `docs/bugs/` from any
   referencing docs.

## Non-goals

- Bidirectional sync between issues and markdown files.
- Project v2 column-based state for the bugs workflow (labels-only in v1).
- Dedup against existing issues during `tasks move` (file presence in
  source is the dedup signal; idempotent across re-runs).
- Wall-clock or quota enforcement in `tasks move` beyond the rate
  throttle.
