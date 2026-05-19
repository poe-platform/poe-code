---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: scaffold-package
    title: Scaffold @poe-code/agent-eval package + frontmatter schema
    prompt: |
      Create a new private package at packages/agent-eval/ with package.json
      (name: @poe-code/agent-eval, private: true, type: module), tsconfig.json,
      README.md (env vars: none; config: see below), and src/index.ts.

      Dependencies to declare: @poe-code/agent-spawn, @poe-code/file-lock,
      @poe-code/process-runner, @poe-code/design-system, toolcraft-schema,
      unzipper.

      Create:

      - src/types.ts — exports EvalTask, EvalRunOptions, EvalRunResult,
        AggregatedCell, AggregateStats, Budget, JudgeSpec, ScorerSpec,
        OracleSource, CheatReport, Verdict, RubricKey. Use plain TypeScript
        types — no zod.
      - src/schema.ts — toolcraft-schema definition for task frontmatter:
        id (string), title (string), oracle (discriminated union: bundled
        { path } | git { url, ref, path }), scorer { command, timeout_ms,
        result_path }, budget { max_iterations, max_tokens, wall_clock_ms },
        judge { agent, model }, rubric (array of "completeness" |
        "spec_adherence" | "code_quality"), weights { tests, judge }.
      - src/tasks/registry.ts — listBundledTasks(): Promise<readonly string[]>
        and loadTask(id): Promise<EvalTask>, reading from packages/agent-eval/tasks/<id>/task.md.

      Update packages/poe-code/package.json to declare @poe-code/agent-eval
      as a workspace dependency (not yet wired into CLI — comes later).

      Add packages/agent-eval/runs/ to the root .gitignore.

      Tests (TDD, per CLAUDE.md):
      - src/schema.test.ts: valid frontmatter passes; missing required fields
        fail with a clear error; oracle discriminated union accepts both
        variants; invalid rubric values rejected.
      - src/tasks/registry.test.ts: uses memfs to verify listing and loading;
        no real disk reads.

      Do not register the CLI yet. Do not implement runEval. Just the
      scaffold + types + schema + registry.
    status:
      implement: open
      test: open
      commit: open

  - id: aggregate
    title: aggregateRuns() — average metrics across repeats
    prompt: |
      In packages/agent-eval/, create src/aggregate.ts exporting:

        export function aggregateRuns(runs: readonly EvalRunResult[]): AggregatedCell;

      For each numeric metric, compute { mean, min, max }. Fields to
      aggregate per repeat:
      - iterations
      - duration_ms
      - usage.input_tokens, usage.output_tokens, usage.cached_tokens, usage.cost_usd
      - tests.pass_rate (also expose pass_rate_min, pass_rate_max,
        pass_rate_mean)
      - judge.mean (when present on every run; otherwise omit judge field
        from the aggregate)
      - correctness

      Also produce:
      - cell: { task, agent, model } — must be identical across input runs;
        throw if they disagree.
      - repeats: input length.
      - cheated_any: true if any run has cheated === true.
      - run_ids: array of input runIds in order.

      Pure function, no side effects, no file I/O. n=3 is the expected case
      but the function must handle n=1, n=2, n=10+.

      Tests (TDD):
      - aggregate.test.ts: n=3 mixed inputs produce correct mean/min/max;
        n=1 collapses to mean=min=max; mismatched cell throws; cheated_any
        truth table; judge absent on one run → judge omitted from output.

      No spawn, no fs, no network. Pure logic.
    status:
      implement: open
      test: open
      commit: open

  - id: cheat-and-budget
    title: CheatFilter and BudgetEnforcer
    prompt: |
      In packages/agent-eval/, add two ACP-event consumers that observe a
      live spawn stream and produce reports/aborts.

      src/run/cheat.ts:

        export class CheatFilter {
          constructor(input: {
            oracleZipPath: string;
            extractedOracleDir: string;
            oracleFilenames: ReadonlySet<string>;
            workspaceDir: string;
          });
          onEvent(event: SpawnEvent): void;
          report(): CheatReport;
        }

      Flag any read / exec / glob event whose path matches:
      - oracleZipPath (exact)
      - any path under extractedOracleDir
      - any path whose basename is in oracleFilenames, EXCEPT when the path
        is under workspaceDir (the agent's own seeded files share names with
        the oracle test suite and that is fine).

      Each flagged event produces { path, toolCall, reason } where reason
      is "oracle-zip" | "oracle-extract" | "oracle-filename".

      src/run/budget.ts:

        export class BudgetEnforcer {
          constructor(budget: Budget, controller: AbortController);
          onEvent(event: SpawnEvent): void;
          snapshot(): {
            iterations: number;
            usage: SpawnUsage;
            elapsedMs: number;
            tripped?: keyof Budget;
          };
        }

      Subscribe to ACP events: count tool_call events as iterations, sum
      usage events into running totals, track elapsed wall clock from
      construction. When any cap is hit, call controller.abort(). snapshot()
      always returns the latest tallies; tripped is set after abort fires.

      Tests (TDD, fast, no spawn):
      - cheat.test.ts: canned event streams produce exact CheatReport;
        workspace-dir override path is not flagged; filename collision
        outside workspace IS flagged.
      - budget.test.ts: each cap (max_iterations, max_tokens, wall_clock_ms)
        individually triggers abort; partial metrics still snapshot
        correctly after abort; never aborts when caps are not hit.

      Both classes are pure consumers — no I/O, no spawn dependency.
    status:
      implement: open
      test: open
      commit: open

  - id: workspace-and-oracle
    title: Workspace setup + oracle extraction
    prompt: |
      In packages/agent-eval/, implement workspace bootstrap and oracle
      handling.

      src/run/workspace.ts:

        export async function createWorkspace(input: {
          taskId: string;
          runId: string;
          starterDir: string;
          outDir: string;          // packages/agent-eval/runs/
        }): Promise<{ workspaceDir: string }>;

      Creates <outDir>/<runId>/workspace/ inside the monorepo so workspace
      deps resolve. Copies starterDir into workspaceDir using
      fs.cp({ recursive: true }). Writes a package.json into the workspace
      that declares the @poe-code/* workspace deps the task expects (read
      from the starter's own package.json — do not synthesize). Acquires a
      file-lock on <outDir>/<runId>/.lock using @poe-code/file-lock and
      returns the workspace path. Caller releases the lock at run end.

      src/run/oracle.ts:

        export async function extractOracle(task: EvalTask): Promise<{
          dir: string;
          filenames: ReadonlySet<string>;
          cleanup: () => Promise<void>;
        }>;

        export async function verifyOracle(id: string): Promise<{
          passed: boolean;
          output: string;
        }>;

      extractOracle: unzip packages/agent-eval/tasks/<id>/oracle.zip into
      a fresh os.tmpdir() subdir (NOT inside the monorepo). Return the
      list of file basenames. cleanup() deletes the temp dir.

      verifyOracle: extract, then run task.scorer.command inside the
      extracted dir via @poe-code/process-runner's host runner with the
      task.scorer.timeout_ms; read scorer.result_path JSON; return
      { passed: passed === total, output: combined stdout/stderr }.

      Tests:
      - workspace.test.ts: uses memfs where possible; checks starter is
        copied, package.json carried through, lock acquired and released.
      - oracle.test.ts: uses a tiny fixture zip checked into the test dir
        (NOT a bundled task oracle); verifies extraction, filename listing,
        cleanup. verifyOracle is covered by the integration test in a later
        task — unit-stub the runner here.
    status:
      implement: open
      test: open
      commit: open

  - id: scorer
    title: runScorer() — invoke task scorer and parse JSON result
    prompt: |
      In packages/agent-eval/, create src/run/scorer.ts:

        export async function runScorer(
          workspaceDir: string,
          spec: ScorerSpec
        ): Promise<{ passed: number; total: number }>;

      Spawns spec.command via @poe-code/process-runner's host runner with
      cwd = workspaceDir and timeout = spec.timeout_ms. The scorer is
      expected to write JSON to spec.result_path (relative to workspaceDir)
      with shape { passed: number, total: number }. Read the file, parse
      JSON (no regex), return.

      If the scorer exits non-zero AND the result file does not exist:
      throw ScorerError with stdout/stderr captured.
      If the result file exists but is malformed JSON or missing fields:
      throw ScorerError.
      If the scorer times out: throw ScorerTimeoutError.

      Export both error classes.

      Tests (TDD, no real subprocess):
      - scorer.test.ts: inject a fake Runner that produces canned output and
        writes a fake result file. Cover: happy path, missing file +
        non-zero exit, malformed JSON, timeout. Use memfs for the result
        file.
    status:
      implement: open
      test: open
      commit: open

  - id: judge
    title: judgeRun() — agent-as-judge scoring with same-agent fallback
    prompt: |
      In packages/agent-eval/, create src/run/judge.ts:

        export async function judgeRun(input: {
          task: EvalTask;
          workspaceDir: string;
          eventsJsonlPath: string;
          testsResult: { passed: number; total: number };
          spec: JudgeSpec;
          agentUnderTest: string;
        }): Promise<Record<RubricKey, number> & { mean: number }>;

      Build a prompt that includes: task prompt (task.prompt), the agent's
      final workspace tree summary (file paths + sizes only, not contents
      — judge inspects via tool calls), the test result counts, and the
      rubric. Ask the judge to score each rubric key 0..5 and respond with
      JSON only: { completeness: n, spec_adherence: n, code_quality: n }.

      Spawn the judge via spawnAutonomous from @poe-code/agent-spawn with
      cwd = workspaceDir (read-only is fine but yolo is acceptable; judge
      should not modify the workspace — set mode: "read" if the agent
      supports it).

      Parse the final text output as JSON. Reject non-numeric or
      out-of-range values; clamp gently to 0..5. Compute mean as the
      arithmetic mean of the three values, rounded to one decimal.

      Same-agent fallback: if spec.agent === agentUnderTest, override
      spec.agent to "codex" (hard fallback). If a caller passes
      judge === "off" upstream, this function is never called.

      Tests (TDD): use createSpawnMock from @poe-code/agent-spawn/testing.
      - judge.test.ts: happy path; same-agent fallback triggers; malformed
        JSON throws; out-of-range values clamp; mean rounding.
    status:
      implement: open
      test: open
      commit: open

  - id: run-eval
    title: runEval() — single-cell orchestration
    prompt: |
      In packages/agent-eval/, create src/run/run.ts and src/run/result-writer.ts.

      src/run/result-writer.ts:

        export async function writeRunArtifacts(runDir: string, parts: {
          result: EvalRunResult;
          events: readonly SpawnEvent[];
          cheatReport: CheatReport;
          judge?: unknown;
          promptMd: string;
        }): Promise<void>;

      Writes atomically (temp file + rename):
      - result.json
      - events.jsonl
      - cheat-report.json (always)
      - judge.json (only if judge ran)
      - prompt.md

      src/run/run.ts:

        export async function runEval(opts: EvalRunOptions): Promise<EvalRunResult>;

      Flow:
      1. loadTask(opts.taskId).
      2. If opts.verifyOracle !== false: verifyOracle(opts.taskId). On
         failure throw — this is a framework error, not an agent failure.
      3. Compute runId =
         `${ISO-without-colons}-${taskId}-${agent}-${model}` plus
         `-r${repeatIndex}` when repeatIndex !== undefined.
      4. createWorkspace().
      5. extractOracle() — keep returned filenames + dir.
      6. Construct CheatFilter and BudgetEnforcer wired to a single
         AbortController.
      7. Call spawnAutonomous with the task prompt, cwd = workspaceDir,
         signal = controller.signal, onEvent forwarding to both filter and
         enforcer AND appending to events buffer.
      8. After spawn: runScorer(workspaceDir, task.scorer).
      9. If opts.judge !== "off" AND no cheating AND no budget trip:
         judgeRun(...).
      10. Compute verdict per the table in the design notes (commit
          history): cheated > budget_exceeded > error > tests-fail > pass.
      11. Compute correctness = cheated ? 0 :
          (tests.pass_rate * task.weights.tests) +
          ((judge?.mean ?? 0) / 5 * task.weights.judge).
      12. writeRunArtifacts() and release file-lock.
      13. Cleanup oracle extract.

      Integration test (run.integration.test.ts):
      - Use createSpawnMock to return a canned ACP event stream + usage.
      - Use a fixture task in tests/__fixtures__/tasks/example/ with a tiny
        oracle.zip whose scorer just writes { passed: 1, total: 1 }.
      - Assert result.json contents, verdict, correctness, cheat report
        empty, workspace dir exists.
    status:
      implement: open
      test: open
      commit: open

  - id: run-matrix
    title: runMatrix() — async-iterable matrix runner with aggregation
    prompt: |
      In packages/agent-eval/, create src/run/matrix.ts:

        export function runMatrix(opts: EvalMatrixOptions): AsyncIterable<EvalRunResult>;

      Expand the matrix into an ordered queue:
        for task in opts.taskIds:
          for agent in opts.agents:
            for model in opts.models:
              for r in 0..opts.repeats:
                yield runEval({ ...opts, taskId: task, agent, model, repeatIndex: r })

      Defaults: repeats = 3, taskIds = listBundledTasks() when omitted.
      Agents and models are required and must be non-empty.

      Failure semantics: if a single cell throws or returns verdict
      "error", yield the (synthetic) EvalRunResult anyway and continue with
      the next cell. The matrix does not abort on cell failure.

      After all repeats for a (task, agent, model) cell complete, call
      aggregateRuns() over those repeats and write
      <outDir>/<matrixId>/aggregate-<task>-<agent>-<model>.json. matrixId
      is the timestamp at the start of runMatrix.

      Integration test (matrix.integration.test.ts):
      - Mock runEval (vi.mock the module) to return canned results for some
        cells and throw for one cell.
      - Assert: iterator yields all expected cells in order, throwing cell
        becomes verdict: "error", aggregate files written per cell.
    status:
      implement: open
      test: open
      commit: open

  - id: report
    title: report loaders + terminal table + markdown rendering
    prompt: |
      In packages/agent-eval/, implement report utilities under src/report/.

      src/report/load.ts:

        export async function loadRunResult(runId: string, outDir?: string): Promise<EvalRunResult>;
        export async function listRuns(outDir?: string): Promise<readonly string[]>;
        export async function loadLatestMatrix(outDir?: string): Promise<{
          matrixId: string;
          cells: readonly AggregatedCell[];
        }>;

      outDir defaults to packages/agent-eval/runs/. Latest matrix is
      identified by the newest subdir whose name starts with a timestamp
      and contains aggregate-*.json files.

      src/report/render-table.ts:

        export function renderMatrixTable(cells: readonly AggregatedCell[]): string;

      Renders the columns shown in the design notes (Task, Agent, Model,
      Iters, Time, Tokens, $, Tests, Judge, Correct, Verdict). Each numeric
      cell shows "mean ±(max−min)/2". Use @poe-code/design-system
      components for consistent style — do not import chalk or @clack
      directly.

      src/report/render-md.ts:

        export function renderMatrixMarkdown(cells: readonly AggregatedCell[]): string;

      Same data as the table, GitHub-flavored markdown pipe table.

      Also expose --all-runs expansion: when callers pass the per-run
      EvalRunResult[] instead of AggregatedCell[], render one row per run.

        export function renderRunsTable(runs: readonly EvalRunResult[]): string;
        export function renderRunsMarkdown(runs: readonly EvalRunResult[]): string;

      Tests:
      - load.test.ts: memfs fixture of runs/ directory; latest-matrix
        detection across multiple matrix IDs; missing dir error.
      - render-table.test.ts: snapshot of rendered table output for a fixed
        AggregatedCell fixture.
      - render-md.test.ts: snapshot of markdown for the same fixture.
    status:
      implement: open
      test: open
      commit: open

  - id: task-mcp-load-tester
    title: First bundled task — mcp-load-tester
    prompt: |
      Author the first golden task. The task is for an agent to build a
      CLI that load-tests an MCP server. The agent works inside a fresh
      package directory; the task is NOT a feature of poe-code itself.

      Create:

      - packages/agent-eval/tasks/mcp-load-tester/task.md with YAML
        frontmatter (per the schema authored in scaffold-package). Set:
        oracle: source: bundled, path: oracle.zip
        scorer: command: npm test, timeout_ms: 120000, result_path: .scorer-result.json
        budget: max_iterations: 80, max_tokens: 500000, wall_clock_ms: 900000
        judge: agent: claude-code, model: anthropic/claude-opus-4.7
        rubric: [completeness, spec_adherence, code_quality]
        weights: tests: 0.7, judge: 0.3
        id: mcp-load-tester
        title: MCP load tester CLI

        Body of task.md: full prompt describing what to build. Required API:
        - CLI: mcp-load-tester run <server-locator> --duration <dur> --rps <n> --tool <name>
        - CLI: mcp-load-tester report <run-id> [--format json|md]
        - Library: load-test wrapper around tiny-mcp-client (stdio + HTTP)
        - Synthetic payloads sized via tokenfill
        - Tool schema caching via @poe-code/cached-resource
        - Live dashboard via @poe-code/design-system (run --watch flag)
        - Per-run JSONL output behind @poe-code/file-lock
        Output the JSONL schema explicitly in the prompt so tests can
        validate it.

      - packages/agent-eval/tasks/mcp-load-tester/starter/package.json
        declaring workspace deps on tiny-mcp-client, @poe-code/cached-resource,
        @poe-code/file-lock, @poe-code/design-system, tokenfill.

      - packages/agent-eval/tasks/mcp-load-tester/starter/ — stub stdio MCP
        server the tests can spin up locally (echoes a fixed tool), README
        with the build instructions, package skeleton (src/index.ts empty
        or with the bare CLI entrypoint).

      - packages/agent-eval/tasks/mcp-load-tester/oracle.zip — author the
        full oracle solution in a working directory, then zip into this
        path. The oracle's package.json includes a `test` script. The
        scorer writes .scorer-result.json with { passed, total }.

      Tests:
      - Add an entry to oracle-verify.integration.test.ts that calls
        verifyOracle("mcp-load-tester") and asserts { passed: true }. This
        is the gate: if the oracle doesn't pass its own tests, the task is
        not valid.

      Do not commit the oracle SOLUTION source to git — only the zip. The
      working directory used to author it should NOT be checked in.
    status:
      implement: open
      test: open
      commit: open

  - id: cli-registration
    title: Register `eval` command group in packages/poe-code
    prompt: |
      Wire @poe-code/agent-eval into the main CLI.

      Add packages/agent-eval/src/cli/commands.ts exporting toolcraft
      command definitions for `run` and `report`. The same definitions
      should produce CLI flags matching:

        poe-code eval run  --agent <a,b,…>  --model <a,b,…>
                          [--task <a,b,…>] [--repeats <n>]
                          [--judge <agent>] [--no-judge]
                          [--no-verify] [--out <dir>]
        poe-code eval report [<run-id>] [--format json|md|table] [--all-runs]

      --agent and --model are REQUIRED (no default, no interactive
      prompt fallback). --repeats default is 3. --task default is all
      bundled tasks.

      In packages/poe-code/src/cli/ (find the existing command-registration
      file by inspecting how `pipeline` is registered), add an `eval`
      command group that delegates to those exports. No business logic in
      packages/poe-code.

      Update packages/poe-code/package.json to include @poe-code/agent-eval
      if not already added.

      Tests:
      - cli.test.ts in packages/agent-eval: invoke the run command in
        dry-run mode (mock runMatrix) and assert flag parsing, required
        validation, default values.
      - Take a screenshot of `poe-code eval --help` and `poe-code eval run
        --help` via `npm run screenshot-poe-code -- eval --help` per the
        CLAUDE.md visual testing rule. Save under packages/agent-eval/
        scripts/screenshots/ for review.
    status:
      implement: open
      test: open
      commit: open

  - id: task-kb
    title: Second bundled task — kb (markdown knowledge-base server)
    prompt: |
      Author the second golden task: a CLI + MCP server over a directory
      of markdown documents.

      Same shape as task-mcp-load-tester: task.md (frontmatter + prompt),
      starter/ (package.json + scaffolding), oracle.zip.

      Required APIs (state explicitly in task.md):
      - CLI commands: kb search <query>, kb read <doc> --section <n>,
        kb outline <doc>, kb cite <doc> --section <n>.
      - Same operations exposed as MCP tools (toolcraft generates both
        surfaces from one set of command definitions).
      - Accepts directory locators (./docs, git+https://…, gh:owner/repo)
        via @poe-code/workspace-resolver.
      - Indexes markdown via @poe-code/markdown-reader.
      - Tracks reading-list assignments via @poe-code/task-list (yaml-file
        backend), state machine draft → planned → in-progress → done →
        archived.
      - Resolves `extends:` chains across plan docs via
        @poe-code/config-extends.

      Starter package.json declares workspace deps on @poe-code/markdown-reader,
      @poe-code/workspace-resolver, @poe-code/task-list, @poe-code/config-extends,
      toolcraft.

      Frontmatter: same defaults as mcp-load-tester except id/title/budget
      may be tuned (kb is heavier — consider max_iterations: 100,
      wall_clock_ms: 1200000).

      Add a verifyOracle("kb") gate in oracle-verify.integration.test.ts.

      Same rule: oracle source not in git, only the zip.
    status:
      implement: open
      test: open
      commit: open

  - id: task-cronctl
    title: Third bundled task — cronctl (declarative job runner)
    prompt: |
      Author the third golden task: a CLI that runs cron-like jobs from a
      YAML definition.

      Same shape as the others: task.md + starter/ + oracle.zip.

      Required APIs (state explicitly in task.md):
      - CLI: cronctl list, cronctl status [--watch], cronctl run-now <id>,
        cronctl logs <id>, cronctl stop.
      - Job runtime: @poe-code/process-runner — supports both host runner
        and docker runner (jobs.yaml declares `runtime: host | docker`).
      - State file runs.json updated atomically via @poe-code/file-lock.
      - Per-job last-success cached via @poe-code/cached-resource
        (memory → disk → bundled fallback). Consumers can read the last
        successful output offline.
      - All commands declared in one toolcraft command set and exposed as
        CLI + MCP + SDK.
      - Live dashboard via @poe-code/design-system for `cronctl status
        --watch`.

      Starter package.json declares workspace deps on @poe-code/process-runner,
      @poe-code/file-lock, @poe-code/cached-resource, @poe-code/design-system,
      toolcraft.

      Frontmatter budget: tune to the largest of the three (max_iterations:
      120, wall_clock_ms: 1500000) since this task exercises docker.

      Add a verifyOracle("cronctl") gate.

      Same rule: oracle source not in git, only the zip.
    status:
      implement: open
      test: open
      commit: open

  - id: e2e-smoke
    title: E2E smoke — one cheap real run per task, gated by EVAL_E2E=1
    prompt: |
      Add an end-to-end smoke that actually spawns a real agent against
      one of the bundled tasks at minimum cost.

      In packages/agent-eval/scripts/e2e-smoke.mjs:
      - Read EVAL_E2E env; exit 0 with a "skipped" message when unset.
      - For each bundled task: invoke runEval with --agent claude-code,
        --model anthropic/claude-haiku-4-5 (cheapest tier), --no-judge,
        --repeats 1, --no-verify (oracle is already verified by
        integration tests).
      - Assert the run completes with a verdict in {pass, fail,
        budget_exceeded} (not "error" or "cheated").
      - Print a summary table at exit.

      Add to root package.json scripts: "e2e:eval": "node packages/agent-eval/scripts/e2e-smoke.mjs".

      Do not write a vitest e2e file — this is a runnable script per
      CLAUDE.md ("QA is not a script" applies only to QA docs; e2e scripts
      are fine but should not require any agent-spawn mocking).

      No new unit tests for this step. The script IS the test.

      Commit the script and the package.json change.
    status:
      implement: open
      commit: open

  - id: docs-and-qa
    title: README, manual QA plan, and final gitignore pass
    prompt: |
      Final polish before sign-off.

      packages/agent-eval/README.md:
      - One-paragraph summary.
      - Environment variables: none.
      - Configuration options under .poe-code/config.json: eval.judge.agent,
        eval.judge.model, eval.out, eval.weights.tests, eval.weights.judge.
      - CLI quickstart (the two `eval run` and `eval report` examples).
      - List of bundled tasks with one-line descriptions.

      packages/agent-eval/qa/run-one.md — manual QA plan in markdown
      (not a script). Steps:
      1. From repo root, run `poe-code eval run --task mcp-load-tester
         --agent claude-code --model anthropic/claude-opus-4.7 --repeats 1
         --no-judge` and confirm a result row appears.
      2. Open packages/agent-eval/runs/<run-id>/result.json and inspect
         the shape.
      3. Run `poe-code eval report` and confirm the latest matrix renders.
      4. Optionally run with --repeats 3 and inspect aggregate-*.json.
      Each step includes the expected outcome and how to triage failure.

      Confirm the root .gitignore contains packages/agent-eval/runs/. Add
      it if step 1 missed it.

      Do NOT add anything to the root README without explicit user
      permission (per CLAUDE.md).
    status:
      implement: open
      commit: open

teardown:
  prompt: |
    Run full test suite and e2e smoke (when EVAL_E2E=1 is set), then
    commit any remaining changes. Confirm `poe-code eval --help` renders
    without error.
---

# Context

Source design notes for this pipeline lived in the same file as a
`kind: plan` document — see git history (`git log --diff-filter=A
docs/plans/29-agent-eval.md`) for the level 1–5 design rationale that
motivates each task above.

Invariants enforced by the pipeline tasks:

- No zod anywhere. Frontmatter validation goes through `toolcraft-schema`.
- No regex on user input (frontmatter, scorer output). Parse YAML/JSON.
- The agent's workspace lives **inside the monorepo** at
  `packages/agent-eval/runs/<run-id>/workspace/` so `@poe-code/*`
  workspace deps resolve naturally.
- Oracle solutions are bundled as `oracle.zip` only. The original
  oracle source is never committed in any form.
- Cheating detection is path-based on ACP tool-call events: zip path,
  extracted oracle dir, and oracle filenames (filename match only
  flagged outside the agent's workspace).
- `--agent` and `--model` are required. No interactive prompt fallback.
- `--repeats` defaults to **3**; reports show mean ± (max−min)/2 per
  cell; `--all-runs` expands.
- Sequential only. One cell at a time.
