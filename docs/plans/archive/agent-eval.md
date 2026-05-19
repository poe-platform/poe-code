---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: scaffold-package
    title: Scaffold @poe-code/agent-eval package
    prompt: >
      Create a new private package at packages/agent-eval/ inside the

      poe-code monorepo.


      Files to create:

      - packages/agent-eval/package.json
          name: "@poe-code/agent-eval"
          private: true
          type: "module"
          main: "dist/index.js"
          types: "dist/index.d.ts"
          scripts: { "build": "tsc", "test": "cd ../.. && vitest run packages/agent-eval/src" }
          dependencies: @poe-code/agent-spawn, @poe-code/file-lock,
              @poe-code/process-runner, @poe-code/design-system,
              toolcraft-schema, simple-git
      - packages/agent-eval/tsconfig.json (extend the repo's base)

      - packages/agent-eval/README.md — one paragraph summary; env vars: none;
        config: lives at <source>/.poe-code-eval.json; mention that the CLI
        is registered in packages/poe-code (no logic in core).
      - packages/agent-eval/src/index.ts — empty placeholder


      Update packages/poe-code/package.json to declare @poe-code/agent-eval

      as a workspace dependency. Do NOT wire the CLI yet — that comes later.


      Confirm the package builds (`tsc`) and `npm test
      --workspace=@poe-code/agent-eval`

      passes (with zero tests).


      Do not add the package to the root README.
    status:
      implement: done
      commit: done
  - id: schema-and-source
    title: Eval schema, source resolver, registry, source-level config
    prompt: >
      In packages/agent-eval/, add the eval source schema and the resolvers

      that discover evals within a directory.


      Files to create:

      - src/types.ts — export EvalSource, EvalDef, EvalRunOptions,
        EvalRunResult, EvalMatrixOptions, AggregatedCell, AggregateStats,
        Budget, JudgeSpec, ScorerSpec, CheatReport, Verdict, PlanKind,
        RubricKey. Plain TypeScript types — NO zod.
      - src/schema.ts — toolcraft-schema definition for eval.yaml with fields:
          id (string), title (string)
          target: { repo (string), ref (string), plan_dest (string, default "docs/plans/eval-task.md") }
          scorer: { command (string), cwd (string, default ""), result_path (string), timeout_ms (number) }
          oracle: { path (string, default "oracle") }
          budget: { max_iterations (number), max_tokens (number), wall_clock_ms (number) }
          judge: { agent (string), model (string), rubric (string[]) }
          weights: { tests (number), judge (number) }
          verify (optional): { command (string), timeout_ms (number) }
      - src/source/open.ts
            export interface EvalSource { rootDir: string }
            export async function openSource(dir: string): Promise<EvalSource>;
        Validates absolute existing directory containing at least one
        <id>/eval.yaml. Throws a clear error otherwise.
      - src/source/registry.ts
            export async function listEvals(source: EvalSource): Promise<readonly string[]>;
            export async function loadEval(source: EvalSource, id: string): Promise<EvalDef>;
        listEvals: shallow scan; returns directory names containing eval.yaml.
        loadEval: parse the YAML (no regex), validate via schema.ts, also
        read plan.md frontmatter to populate `plan.kind`. Reject if kind not
        in {"plan","pipeline","superintendent","experiment"}.
      - src/source/config.ts
            export async function loadSourceConfig(source: EvalSource): Promise<SourceConfig>;
        Reads <source>/.poe-code-eval.json if present; returns defaults
        (judge agent claude-code / opus-4.7, out "runs", weights 0.7/0.3,
        clone_cache_dir null) for missing keys.

      Tests (TDD, fast, use memfs):

      - src/schema.test.ts: valid eval.yaml passes; each missing required
        field rejected with clear error; defaults applied.
      - src/source/open.test.ts: directory without eval.yaml rejected;
        directory with one rejected if not absolute; valid case returns
        EvalSource.
      - src/source/registry.test.ts: shallow scan; nested dirs not
        discovered; bad plan kind in plan.md rejected.
      - src/source/config.test.ts: missing file → all defaults; partial
        file → merged with defaults; bad JSON throws.

      Update src/index.ts to re-export these.
    status:
      implement: done
      test: done
      commit: done
  - id: aggregate
    title: aggregateRuns — average metrics across repeats
    prompt: >
      In packages/agent-eval/, create src/aggregate.ts exporting:

        export interface AggregateStats { mean: number; min: number; max: number }
        export function aggregateRuns(runs: readonly EvalRunResult[]): AggregatedCell;

      Aggregate per-metric mean/min/max for: iterations, durationMs,

      usage.inputTokens, usage.outputTokens, usage.cachedTokens,

      usage.costUsd, correctness, and judge.mean (when present on every

      run). For tests, compute passRateMean/passRateMin/passRateMax.


      Produce on the aggregate:

      - cell: { eval, agent, model, planKind } — must be identical across
        input runs; throw if they disagree.
      - repeats: input length.

      - cheated_any: true if any run has cheated === true.

      - runIds: array of input runIds in input order.


      Pure function. No file I/O. No spawn. Handles n=1..n=large.


      Tests:

      - aggregate.test.ts: n=3 mixed inputs produce correct mean/min/max;
        n=1 collapses to mean=min=max; mismatched cell throws;
        cheated_any truth table; judge absent on one run → judge omitted.

      Update src/index.ts to re-export aggregateRuns and AggregateStats.
    status:
      implement: done
      test: done
      commit: done
  - id: cheat-and-budget
    title: CheatFilter (outside-clone) and BudgetEnforcer
    prompt: >
      In packages/agent-eval/, add two ACP-event consumers.


      src/run/cheat.ts:

        export class CheatFilter {
          constructor(input: { cloneDir: string; allowedPaths?: readonly string[] });
          onEvent(event: SpawnEvent): void;
          report(): CheatReport;
        }

      Flag any read/exec/glob event whose resolved absolute path is NOT

      under cloneDir AND NOT under any path in allowedPaths. Default

      allowedPaths includes os.tmpdir(), os.homedir() + "/.cache",

      and common system bins ("/usr/bin", "/usr/local/bin", "/bin",

      and on macOS also "/opt/homebrew/bin"). Each flagged event:

      { path, toolCall, reason: "outside-clone" }.


      src/run/budget.ts:

        export class BudgetEnforcer {
          constructor(budget: Budget, controller: AbortController);
          onEvent(event: SpawnEvent): void;
          snapshot(): { iterations: number; usage: SpawnUsage; elapsedMs: number; tripped?: keyof Budget };
        }

      Count tool_call events as iterations, sum usage events, track wall

      clock from construction. When any cap is hit call controller.abort().

      snapshot() returns latest tallies; tripped is set after abort fires.


      Tests (TDD, no spawn):

      - cheat.test.ts: paths inside clone pass; allowlisted paths pass;
        unrelated paths flagged; relative paths resolved against cloneDir.
      - budget.test.ts: each cap individually triggers abort exactly once;
        partial metrics snapshot correctly after abort; never aborts when
        caps not hit.

      Pure consumers — no I/O. Update src/index.ts to re-export.
    status:
      implement: done
      test: done
      commit: done
  - id: clone
    title: Target-repo cloning with optional cache
    prompt: |
      In packages/agent-eval/, create src/run/clone.ts:

        export async function cloneTarget(input: {
          repo: string;
          ref: string;
          dest: string;
          cacheDir?: string | null;
          signal?: AbortSignal;
        }): Promise<{ resolvedSha: string }>;

      Use `simple-git`. Default behavior (cacheDir null): `git clone
      --depth 1 --branch <ref> <repo> <dest>`. With cacheDir: maintain a
      bare repo at <cacheDir>/<hash(repo)>.git (clone once, fetch on
      subsequent calls), then `git worktree add <dest> <ref>`. After
      either path, run `git rev-parse HEAD` inside <dest> and return
      resolvedSha.

      Honors AbortSignal (kill the running git process).

      Tests (integration, real fs but a local bare-repo fixture):
      - clone.integration.test.ts: set up a tiny local bare repo with two
        commits in a tmpdir; clone happy path; resolvedSha matches HEAD;
        cacheDir path (clone then re-clone uses cache); abort mid-clone
        leaves dest cleaned up.

      Update src/index.ts to re-export cloneTarget.
    status:
      implement: done
      test: done
      commit: done
  - id: dispatch
    title: Plan-kind dispatch resolver
    prompt: >
      In packages/agent-eval/, create src/run/dispatch.ts. This module is

      a PURE RESOLVER — it does not spawn anything itself.

        export type PlanKind = "plan" | "pipeline" | "superintendent" | "experiment";

        export interface DispatchSpec {
          /** Either an agent CLI name (kind: plan) or "node" for orchestrated kinds. */
          kind: "agent" | "node";
          /** When kind === "agent", the agent CLI id. */
          agent?: string;
          /** When kind === "node", absolute path to the JS file to run. */
          script?: string;
          /** Args appended after the script. */
          args: readonly string[];
          /** Prompt to pass when kind === "agent". */
          prompt?: string;
        }

        export function resolveDispatch(input: {
          planKind: PlanKind;
          planBody: string;             // plan.md body without frontmatter
          planPath: string;             // absolute path inside the clone
          agent: string;                // selected agent id
          model: string;
          poeCodeCliPath: string;       // absolute path to packages/poe-code/dist/cli.js
        }): DispatchSpec;

      Mapping:

      - "plan" → { kind: "agent", agent: <agent>, prompt: <planBody>, args: [] }

      - "pipeline" → { kind: "node", script: poeCodeCliPath,
            args: ["pipeline", "run", "--plan", planPath, "--agent", agent, "--model", model] }
      - "superintendent" → { kind: "node", script: poeCodeCliPath,
            args: ["superintendent", "run", planPath, "--agent", agent, "--model", model] }
      - "experiment" → { kind: "node", script: poeCodeCliPath,
            args: ["experiment", "run", "--doc", planPath, "--agent", agent, "--model", model] }
      - Anything else: throw `UnsupportedPlanKindError`.


      Tests (no spawn):

      - dispatch.test.ts: each kind produces the exact expected
        DispatchSpec; unsupported kind throws.

      Update src/index.ts to re-export resolveDispatch + DispatchSpec.
    status:
      implement: done
      test: done
      commit: done
  - id: verify-oracle
    title: verifyOracle — runs eval-defined verify command
    prompt: |
      In packages/agent-eval/, create src/run/oracle.ts:

        export async function verifyOracle(
          source: EvalSource,
          id: string
        ): Promise<{ passed: boolean; output: string }>;

      Behavior:
      - Load EvalDef via loadEval(source, id).
      - If eval.yaml has no `verify` block, return { passed: true, output:
        "no verify command configured" } (verification is opt-in per eval).
      - Otherwise: spawn `verify.command` via @poe-code/process-runner host
        runner with cwd = <source>/<id>/oracle. Set env:
          ORACLE_DIR=<source>/<id>/oracle (absolute)
        Enforce verify.timeout_ms. Combine stdout+stderr into `output`.
        passed = exitCode === 0.

      Tests:
      - oracle.test.ts: no verify block → passed: true;
        verify command succeeds → passed: true with captured output;
        non-zero exit → passed: false; timeout → throws / passed: false
        with note. Use a fake Runner from process-runner — do not spawn
        real processes.

      Update src/index.ts to re-export verifyOracle.
    status:
      implement: done
      test: done
      commit: done
  - id: scorer
    title: runScorer — invoke scorer.command, parse JSON result
    prompt: |
      In packages/agent-eval/, create src/run/scorer.ts:

        export class ScorerError extends Error {}
        export class ScorerTimeoutError extends Error {}

        export async function runScorer(
          cloneDir: string,
          oracleDir: string,
          spec: EvalDef["scorer"]
        ): Promise<{ passed: number; total: number }>;

      Spawn spec.command via @poe-code/process-runner host runner with
      cwd = path.join(cloneDir, spec.cwd) (spec.cwd may be ""), timeout
      = spec.timeoutMs. Inject env: CLONE_DIR=<cloneDir>,
      ORACLE_DIR=<oracleDir>. Both absolute.

      After exit:
      - Read spec.resultPath relative to cloneDir.
      - JSON.parse (no regex). Require { passed: number, total: number }.
      - If file is missing AND exit code non-zero → throw ScorerError with
        stdout/stderr.
      - If file present but malformed → throw ScorerError.
      - If timed out → throw ScorerTimeoutError.

      Tests:
      - scorer.test.ts: happy path; missing file + non-zero exit;
        malformed JSON; timeout. Use memfs for the result file, fake
        Runner from process-runner.

      Update src/index.ts to re-export runScorer + error classes.
    status:
      implement: done
      test: done
      commit: done
  - id: judge
    title: judgeRun — agent-as-judge with same-agent fallback
    prompt: |
      In packages/agent-eval/, create src/run/judge.ts:

        export async function judgeRun(input: {
          evalDef: EvalDef;
          cloneDir: string;
          eventsJsonlPath: string;
          testsResult: { passed: number; total: number };
          spec: JudgeSpec;            // { agent, model, rubric }
          agentUnderTest: string;
        }): Promise<Record<RubricKey, number> & { mean: number }>;

      Build a prompt that includes: the task prompt (evalDef.plan body),
      a list of files+sizes in cloneDir (NOT contents — judge inspects
      via tool calls), the testsResult counts, and the rubric.
      Instructions: respond with JSON only:
          { "completeness": n, "spec_adherence": n, "code_quality": n }
      where each n is 0..5 (only rubric keys present in evalDef.judge.rubric).

      Spawn via spawnAutonomous from @poe-code/agent-spawn with cwd =
      cloneDir, mode "read" if the agent supports it, otherwise yolo.

      Parse the final text output as JSON. Clamp each value to [0, 5];
      coerce non-numeric to 0. Mean = arithmetic mean of present rubric
      values rounded to one decimal.

      Same-agent fallback: if spec.agent === agentUnderTest, override
      spec.agent to "codex" before spawning.

      Tests (using createSpawnMock from @poe-code/agent-spawn/testing):
      - judge.test.ts: happy path; same-agent fallback flips to codex;
        malformed JSON in agent output throws; out-of-range values
        clamped; mean rounding to 1 decimal.

      Update src/index.ts to re-export judgeRun.
    status:
      implement: done
      test: done
      commit: done
  - id: run-eval
    title: runEval — single-cell orchestrator
    prompt: >
      In packages/agent-eval/, create src/run/run.ts and

      src/run/result-writer.ts.


      src/run/result-writer.ts:

        export async function writeRunArtifacts(runDir: string, parts: {
          result: EvalRunResult;
          events: readonly SpawnEvent[];
          cheatReport: CheatReport;
          judge?: unknown;
          planMd: string;
          evalYaml: string;
        }): Promise<void>;

      Atomic writes (temp file + rename) for:

      - result.json

      - events.jsonl

      - cheat-report.json (always, even when empty)

      - judge.json (only if judge ran)

      - plan.md (copy of <source>/<id>/plan.md)

      - eval.yaml (copy of <source>/<id>/eval.yaml)


      src/run/run.ts:

        export async function runEval(opts: EvalRunOptions): Promise<EvalRunResult>;

      Flow:

      1. openSource(opts.sourceDir) → source. loadEval(source, opts.evalId)
         → evalDef.
      2. Resolve absolute poeCodeCliPath by reading the workspace path to
         packages/poe-code/dist/cli.js (relative to this module's file URL).
      3. If opts.verifyOracle !== false: await verifyOracle(source, opts.evalId)
         → if !passed, throw a framework error.
      4. runId =
      `${isoUtcSafe(now())}-${evalId}-${agent}-${model.replace(/[/]/g,"-")}`
         + (repeatIndex !== undefined ? `-r${repeatIndex}` : "").
      5. runDir = path.join(opts.outDir ?? "runs", runId). Acquire lock at
         runDir + ".lock" via @poe-code/file-lock.
      6. cloneDir = path.join(runDir, "clone");
         await cloneTarget({ repo, ref, dest: cloneDir, cacheDir: opts.cloneCacheDir, signal })
         → resolvedSha.
      7. If <source>/<id>/starter exists, rsync over cloneDir (fs.cp
         recursive).
      8. Copy <source>/<id>/plan.md to path.join(cloneDir, target.planDest)
         (mkdir -p the parent).
      9. Construct CheatFilter({ cloneDir }) and
         BudgetEnforcer(evalDef.budget, controller).
      10. Resolve dispatch via resolveDispatch({ planKind, planBody,
          planPath, agent: opts.agent, model: opts.model, poeCodeCliPath }).
      11. Call spawnAutonomous with cwd=cloneDir, signal=controller.signal,
          onEvent forwarding to filter, enforcer, and an events buffer.
          The exact spawn shape depends on dispatch.kind ("agent" vs
          "node") — see resolveDispatch's return type.
      12. After spawn: oracleDir = path.join(source.rootDir, opts.evalId,
          evalDef.oracle.path). testsResult = await runScorer(cloneDir,
          oracleDir, evalDef.scorer).
      13. judgeResult = (opts.judge !== "off" && !cheated && !budgetTrip)
          ? await judgeRun(...) : undefined.
      14. Verdict order (first match wins): cheated → "cheated";
          budget tripped → "budget_exceeded"; tests.total === 0 ||
          (testsResult.passed === 0 && total > 0) → "fail";
          spawn errored → "error"; else "pass".
      15. correctness = cheated ? 0 :
          (testsResult.passed/testsResult.total) * weights.tests +
          (judgeResult?.mean ?? 0) / 5 * weights.judge.
      16. await writeRunArtifacts(runDir, ...). Release lock.


      Integration tests (run-<kind>.integration.test.ts × 4 — plan,

      pipeline, superintendent, experiment):

      - Use createSpawnMock + a fixture eval source at
        packages/agent-eval/src/__fixtures__/source/example-<kind>/ with
        a tiny oracle/score.mjs that writes { passed: 1, total: 1 }.
      - Mock cloneTarget to copy a fixture clone tree instead of running git.

      - Assert result.json shape, verdict, correctness, cheat empty,
        cloneDir exists with starter + plan copied in.

      Update src/index.ts to re-export runEval.
    status:
      implement: done
      test: done
      commit: done
  - id: run-matrix
    title: runMatrix — async-iterable + per-cell aggregation
    prompt: >
      In packages/agent-eval/, create src/run/matrix.ts:

        export function runMatrix(opts: EvalMatrixOptions): AsyncIterable<EvalRunResult>;

      Defaults: repeats = 3, evalIds = await listEvals(source) when

      omitted. Agents and models required, non-empty arrays.


      Expand to ordered queue:
        for evalId in opts.evalIds:
          for agent in opts.agents:
            for model in opts.models:
              for r in 0..opts.repeats:
                yield runEval({ sourceDir, evalId, agent, model, repeatIndex: r, … })

      Failure semantics: when a single runEval throws, yield a synthetic

      EvalRunResult with verdict: "error" and the captured error message,

      then continue.


      After all repeats for a (evalId, agent, model) cell finish, call

      aggregateRuns over those repeats and write

      <outDir>/<matrixId>/aggregate-<evalId>-<agent>-<modelSafe>.json.

      matrixId = ISO timestamp captured at the start of runMatrix.


      Integration test:

      - matrix.integration.test.ts: vi.mock the run module to make
        runEval return canned results for some cells and throw for one;
        assert iterator yields all cells in order, error cell becomes
        verdict "error", aggregate file written per (eval, agent, model).

      Update src/index.ts to re-export runMatrix.
    status:
      implement: done
      test: done
      commit: done
  - id: report
    title: Report loaders + terminal table + markdown rendering
    prompt: >
      In packages/agent-eval/, implement report utilities.


      src/report/load.ts:

        export async function loadRunResult(runId: string, outDir?: string): Promise<EvalRunResult>;
        export async function listRuns(outDir?: string): Promise<readonly string[]>;
        export async function loadLatestMatrix(outDir?: string): Promise<{
          matrixId: string;
          cells: readonly AggregatedCell[];
        }>;

      outDir defaults to "runs". loadLatestMatrix picks the newest matrix

      subdir (timestamp-prefixed, contains aggregate-*.json) and reads

      every aggregate file inside.


      src/report/render-table.ts:

        export function renderMatrixTable(cells: readonly AggregatedCell[]): string;
        export function renderRunsTable(runs: readonly EvalRunResult[]): string;

      Columns for matrix: Eval, Plan, Agent, Model, Iters, Time, Tokens,

      $, Tests, Judge, Correct, Verdict. Numeric cells render as

      "mean ±(max−min)/2" (1 decimal place, k/M suffix for tokens, m/s

      for time). Use @poe-code/design-system components. Do NOT import

      chalk or @clack directly.


      src/report/render-md.ts:

        export function renderMatrixMarkdown(cells: readonly AggregatedCell[]): string;
        export function renderRunsMarkdown(runs: readonly EvalRunResult[]): string;

      Same columns as the terminal version, GitHub-flavored pipe table.


      Tests:

      - load.test.ts: memfs fixture of runs/ directory with multiple
        matrices and a per-run JSON; latest-matrix detection; missing dir
        clear error.
      - render-table.test.ts: snapshot of rendered output for a fixed
        AggregatedCell fixture.
      - render-md.test.ts: snapshot of markdown for the same fixture.


      Update src/index.ts to re-export the load functions.
    status:
      implement: done
      test: done
      commit: done
  - id: cli-registration
    title: Register `poe-code eval` command group
    prompt: |
      Wire @poe-code/agent-eval into the main CLI.

      Create packages/agent-eval/src/cli/commands.ts exporting toolcraft
      command definitions for the two commands:

        poe-code eval run  --agent <a,b,…>  --model <a,b,…>
                          [-C <dir>] [--eval <a,b,…>]
                          [--repeats <n>] [--judge <agent>] [--no-judge]
                          [--no-verify] [--out <dir>]

        poe-code eval report [<run-id>] [-C <dir>]
                             [--format json|md|table] [--all-runs]
                             [--out <dir>]

      Required: --agent, --model. No defaults, no interactive prompt
      fallback. --repeats defaults to 3. -C defaults to process.cwd().
      --eval defaults to every eval found in the source. --format
      defaults to table.

      `run` resolves source via openSource(-C ?? cwd), reads
      .poe-code-eval.json for defaults, calls runMatrix, prints the table
      as each cell finishes (streaming from the async iterable).
      `report` calls loadLatestMatrix (or loadRunResult when an id is
      given) and prints via the chosen renderer.

      In packages/poe-code/src/cli/ (find how `pipeline` is registered as
      a reference), add an `eval` command group that delegates to those
      exports. NO business logic in packages/poe-code. Update the
      packages/poe-code/package.json deps if @poe-code/agent-eval is not
      already declared.

      Tests:
      - cli.test.ts in packages/agent-eval: parse the run command in
        dry-run mode (mock runMatrix) and assert: --agent required,
        --model required, --repeats default 3, -C default cwd, --eval
        defaults to all, --no-judge flag, --no-verify flag.

      Manual visual check: run
          npm run screenshot-poe-code -- eval --help
          npm run screenshot-poe-code -- eval run --help
      and save the screenshots under packages/agent-eval/scripts/screenshots/.
      Confirm the output uses the design-system style (no raw chalk).
    status:
      implement: done
      test: done
      commit: done
  - id: e2e-smoke
    title: E2E smoke test gated by EVAL_E2E=1
    prompt: |
      Add an end-to-end smoke at packages/agent-eval/scripts/e2e-smoke.mjs.

      Behavior:
      - If process.env.EVAL_E2E is not "1", print "skipped" and exit 0.
      - Otherwise: point at a tiny fixture eval source committed at
        packages/agent-eval/src/__fixtures__/e2e-source/ containing one
        `kind: plan` eval with a minimal target (a bare local repo
        fixture at packages/agent-eval/src/__fixtures__/e2e-target.git/
        with one file). The plan prompt: "Create a file hello.txt
        containing the word 'hello'." The scorer: a Node script that
        checks the file content and writes { passed, total } to
        .scorer-result.json.
      - Invoke runEval with: --agent claude-code (or whichever is on
        PATH), --model anthropic/claude-haiku-4-5-20251001 (cheapest),
        --no-judge, --no-verify, repeatIndex omitted.
      - Assert verdict ∈ {"pass","fail","budget_exceeded"}; never "error"
        or "cheated".
      - Print result.json contents.

      Add packages/agent-eval/package.json script "e2e": "node
      scripts/e2e-smoke.mjs". No root package.json change.

      This is a script, not a vitest file. No new unit tests for this
      step — the script IS the test.
    status:
      implement: done
      commit: done
  - id: docs-and-qa
    title: README pass + manual QA plan
    prompt: >
      Final polish.


      packages/agent-eval/README.md:

      - One-paragraph summary of the harness.

      - Environment variables: none.

      - Configuration: lives at <source>/.poe-code-eval.json. List keys:
        judge (agent, model), out, weights (tests, judge), clone_cache_dir.
      - CLI quickstart:
          cd ../poe-code-eval
          poe-code eval run --agent claude-code --model anthropic/claude-opus-4.7
          poe-code eval report
      - Section "Authoring an eval" — describe the folder layout
        (eval.yaml, plan.md, oracle/, optional starter/) and the env
        vars passed to scorer.command (CLONE_DIR, ORACLE_DIR).
      - Section "Plan kinds" — list the four supported kinds and what
        each dispatches to.

      packages/agent-eval/qa/run-one.md — manual QA plan in markdown

      (not a script):

      1. Create a tiny throwaway eval source dir with one `kind: plan`
         eval that asks the agent to create a file. Step-by-step
         commands.
      2. cd into it and run `poe-code eval run --agent claude-code
         --model anthropic/claude-opus-4.7 --repeats 1 --no-judge
         --no-verify`. Expected: a result row prints.
      3. Inspect runs/<run-id>/result.json. Expected fields listed.

      4. Run `poe-code eval report`. Expected: latest matrix renders.

      5. Re-run with --repeats 3 and inspect aggregate-*.json.

      Each step includes triage notes for the common failure modes.


      Do NOT add anything to the root README without explicit user

      permission (per CLAUDE.md).
    status:
      implement: done
      commit: done
teardown:
  prompt: >
    Run the package's full test suite (`npm test
    --workspace=@poe-code/agent-eval`)

    and the e2e smoke (with EVAL_E2E=1 if credentials are configured),

    then commit any remaining changes. Confirm `poe-code eval --help`

    renders without error.
name: agent-eval
state: archived
---

# Context

Source design notes for this pipeline lived in the same file as a
`kind: plan` document — see git history (`git log -p docs/plans/29-agent-eval.md`)
for the level 1–5 design rationale that motivates each task above.

Architecture invariants enforced by the tasks below:

- Harness is a package inside `poe-code` — `packages/agent-eval/`. CLI is
  registered in `packages/poe-code/` only (no logic there).
- No bundled evals. Source resolves from cwd by default; `-C <dir>`
  overrides. Sources are local directories.
- Each eval is one folder: `eval.yaml`, `plan.md`, `oracle/`, optional
  `starter/`.
- Agent's `cwd = cloneDir` (a fresh clone of the eval's target repo).
  The eval source is NOT mounted into the clone, so the oracle directory
  is naturally inaccessible to the agent. The `outside-clone` cheating
  filter is defense in depth.
- Plan kinds: `plan`, `pipeline`, `superintendent`, `experiment`. The
  harness dispatches each to a different child command but observes them
  uniformly through `spawnAutonomous` from `@poe-code/agent-spawn`.
- `poe-code` binary for orchestrated kinds is the harness's own
  `packages/poe-code/dist/cli.js` — target repos are not required to
  depend on poe-code.
- `--agent` and `--model` are REQUIRED on `eval run`. No defaults, no
  interactive fallback.
- `--repeats` defaults to **3**. Metrics are averaged in the report as
  `mean ±(max−min)/2`. `--all-runs` expands.
- Source-level config lives at `<source>/.poe-code-eval.json`.
- No zod. No regex on user input. Use `toolcraft-schema` for `eval.yaml`
  and parse YAML/JSON directly.
- Sequential only. One cell at a time.
