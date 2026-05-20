---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: schema-update
    title: Make scorer optional; codify oracle/{tests,solution}/ layout
    prompt: |
      Update packages/agent-eval/ to make the eval.yaml `scorer` block
      optional and to document the canonical oracle folder shape.

      Changes in packages/agent-eval/src/schema.ts:
      - Make `scorer` a top-level optional field. When omitted, the
        harness uses its built-in vitest runner against <evalDir>/oracle/tests/.
      - Add JSDoc on the schema describing the canonical layout:
          oracle/
          ├── solution/    # reference implementation; used by `eval check`
          └── tests/       # vitest *.test.ts files; the default scorer
      - Keep the existing `oracle: { path }` field but document that the
        default value "oracle" should be used unless an eval has a strong
        reason to deviate.

      Changes in packages/agent-eval/src/types.ts:
      - EvalDef.scorer becomes `ScorerSpec | undefined`.
      - Add a discriminated helper type:
          export type ResolvedScorer =
            | { kind: "custom"; spec: ScorerSpec }
            | { kind: "vitest"; testsDir: string };
        and export a pure function:
          export function resolveScorer(evalDef: EvalDef): ResolvedScorer;
        Returns vitest when scorer is absent; testsDir defaults to
        path.join(evalDir, oracle.path, "tests").

      Tests (TDD, fast):
      - schema.test.ts: eval.yaml without `scorer` validates; with
        `scorer` still validates; partial `scorer` (missing required
        sub-fields) still rejected.
      - types.test.ts (or co-located): resolveScorer returns
        { kind: "vitest", … } when scorer absent; returns
        { kind: "custom", … } when present; testsDir path is absolute
        and correctly joined.

      No CLI changes in this task. No runtime behavior changes — only
      the type surface + schema. Update src/index.ts re-exports.
    status:
      implement: done
      test: done
      commit: done

  - id: vitest-runner
    title: Bundled vitest scorer + per-case results in result.json
    prompt: |
      Add a default scorer that runs vitest against <evalDir>/oracle/tests/
      and expose per-case results all the way through to result.json.

      Add vitest as a dependency of packages/agent-eval/package.json
      (use the version already in the monorepo's root devDependencies —
      check ../../package.json).

      Create packages/agent-eval/src/run/vitest-runner.ts:

        export interface CaseResult {
          name: string;            // fully qualified, e.g. "src/foo.test.ts > does X"
          passed: boolean;
          durationMs: number;
          message?: string;        // failure message when !passed
        }
        export async function runVitest(input: {
          testsDir: string;        // absolute
          cloneDir: string;        // absolute
          oracleDir: string;       // absolute
          timeoutMs: number;       // default 180_000
          signal?: AbortSignal;
        }): Promise<{ passed: number; total: number; cases: CaseResult[] }>;

      Implementation:
      - Spawn `node` against vitest's binary (resolve via
        require.resolve("vitest/package.json") then the .bin/vitest in
        that package's parent node_modules), arguments:
          ["run", "--root", testsDir, "--reporter=json",
           "--outputFile", <tmp>.json]
        Inject env: CLONE_DIR=<cloneDir>, ORACLE_DIR=<oracleDir>.
      - When vitest exits, read <tmp>.json. Map vitest's JSON shape to
        the CaseResult shape above. Both passing AND failing tests must
        be captured. Total = number of tests; passed = number where
        result.state === "pass".
      - Timeout: reject with VitestTimeoutError after timeoutMs; honor
        AbortSignal.
      - Always delete <tmp>.json before returning.

      Update packages/agent-eval/src/run/scorer.ts:
      - Replace the existing `runScorer(cloneDir, oracleDir, spec)` with
        a dispatcher that takes the EvalDef directly:

          export async function runScorer(input: {
            evalDef: EvalDef;
            evalDir: string;        // absolute path to <source>/<id>/
            cloneDir: string;       // absolute
            signal?: AbortSignal;
          }): Promise<{ passed: number; total: number; cases: CaseResult[] }>;

      - Use resolveScorer(evalDef) to pick the branch:
        - vitest: call runVitest with testsDir = <evalDir>/oracle/tests/,
          oracleDir = <evalDir>/oracle.
        - custom: existing behavior, but parse spec.result_path JSON as
          either { passed, total } (legacy) or
          { passed, total, cases } (new). Synthesize empty cases array
          when missing.

      Update types.ts EvalRunResult.tests:

        tests: { passed: number; total: number; pass_rate: number; cases: CaseResult[] };

      Update src/run/result-writer.ts and src/run/run.ts to propagate
      `cases` end-to-end. aggregate.ts is unaffected — it aggregates the
      summary (pass_rate/passed/total), not per-case.

      Tests (TDD, fast):
      - vitest-runner.test.ts: spawn vitest via a fake Runner from
        @poe-code/process-runner; feed canned JSON reporter output;
        assert CaseResult mapping; timeout handling; tmp file deleted.
        Do NOT actually spawn vitest in the unit test — that's covered
        in an integration test below.
      - vitest-runner.integration.test.ts: write a tiny *.test.ts file
        into a memfs-backed dir (or a real tmp dir), point runVitest at
        it, assert real vitest produced the expected cases. Marked with
        a long timeout (30s).
      - scorer.test.ts: dispatcher picks vitest branch when scorer
        absent, custom branch when present; both branches return the
        new shape including cases.
      - run-eval result.json contains tests.cases populated from the
        scorer. Update fixture expectations.

      Update src/index.ts re-exports.
    status:
      implement: done
      test: done
      commit: done

  - id: eval-check
    title: "`poe-code eval check` — run scorer against oracle solution, no agent"
    prompt: |
      Add the `check` command. This is the inner-loop tool for eval authors.

      Create packages/agent-eval/src/check/check.ts:

        export interface CheckOptions {
          sourceDir: string;       // absolute, contains the eval folder
          evalId: string;          // folder name to check
          signal?: AbortSignal;
        }
        export interface CheckResult {
          evalId: string;
          cloneDir: string;        // path for inspection; not auto-cleaned
          tests: { passed: number; total: number; cases: CaseResult[] };
          durationMs: number;
        }
        export async function evalCheck(opts: CheckOptions): Promise<CheckResult>;

      Flow:
      1. openSource(sourceDir) + loadEval(source, evalId).
      2. cloneDir = path.join(<outDir>, ".check", evalId, "<iso-ts>", "clone").
         outDir respects .poe-code-eval.json; default "runs". Inside .check/
         so it's clearly separate from real run artifacts.
      3. cloneTarget({ repo, ref, dest: cloneDir, signal }).
      4. If <source>/<evalId>/starter/ exists, copy into clone.
      5. Copy <source>/<evalId>/oracle/solution/* into clone. The
         destination root within the clone is the clone root by default;
         eval.yaml MAY add `oracle.solution_dest` (string, relative to
         clone root, defaults to "."). Document this in schema-update
         comments — implement it here even if added retroactively to
         the schema.
      6. Run scorer via runScorer({ evalDef, evalDir, cloneDir, signal }).
      7. Return CheckResult.

      Add a CLI wrapper at packages/agent-eval/src/cli/check.ts that the
      CLI registration task will hook into:

        export interface CheckCliInput { evalId?: string; sourceDir?: string }
        export async function runCheckCli(input: CheckCliInput): Promise<number>;

      Behavior:
      - sourceDir defaults to process.cwd().
      - evalId default: if exactly one eval exists in source, use it;
        else error with a hint listing available ids.
      - On exit: render a per-case table via @poe-code/design-system —
        green checkmark vs red X per case, total summary line at the
        bottom, exit code 0 if all cases pass, 1 otherwise.

      Tests:
      - check.test.ts: mock cloneTarget + runScorer; verify solution is
        copied into clone, runScorer called with correct args, errors
        propagate.
      - cli-check.test.ts: cwd default; auto-select single eval; error
        when multiple evals + no --eval; exit code reflects test result.

      Snapshot:
      - One snapshot of the rendered per-case table for a fixed
        CheckResult fixture.

      Update src/index.ts re-exports.
    status:
      implement: open
      test: open
      commit: open

  - id: eval-init
    title: "`poe-code eval init <name>` — scaffold a lint-clean eval folder"
    prompt: |
      Add the `init` command. Generates a minimal working eval folder
      that passes `lint` immediately.

      Create packages/agent-eval/src/init/init.ts:

        export interface InitOptions {
          sourceDir: string;       // absolute; folder is created under here
          name: string;            // folder name, kebab-case
          kind: "plan" | "pipeline" | "superintendent" | "experiment";
          targetRepo?: string;     // default: git+https://github.com/poe-platform/poe-code.git
          targetRef?: string;      // default: main
        }
        export interface InitResult {
          evalDir: string;         // absolute path to created folder
          files: readonly string[]; // relative paths of created files
        }
        export async function evalInit(opts: InitOptions): Promise<InitResult>;

      Files created at <sourceDir>/<name>/:
      - eval.yaml:
          id: <name>
          title: "<Name>"
          target: { repo: <opts.targetRepo>, ref: <opts.targetRef>,
                    plan_dest: "docs/plans/eval-task.md" }
          oracle: { path: "oracle" }
          budget: { max_iterations: 60, max_tokens: 400000, wall_clock_ms: 600000 }
          judge: { agent: "claude-code",
                   model: "anthropic/claude-opus-4.7",
                   rubric: ["completeness", "spec_adherence", "code_quality"] }
          weights: { tests: 0.7, judge: 0.3 }
        # no `scorer` block — vitest default is used
      - plan.md: frontmatter `{ kind: <opts.kind>, version: 1 }` plus a
        one-line prompt body: "Replace this with the task prompt the
        agent will see."
      - oracle/tests/example.test.ts:

          import { describe, expect, it } from "vitest";
          import { readFileSync, existsSync } from "node:fs";
          import { join } from "node:path";

          const CLONE_DIR = process.env.CLONE_DIR!;
          const ORACLE_DIR = process.env.ORACLE_DIR!;

          describe("example", () => {
            it("agent created the expected file", () => {
              const path = join(CLONE_DIR, "OUTPUT.md");
              expect(existsSync(path)).toBe(true);
            });
          });

      - oracle/solution/OUTPUT.md: a one-line file containing "ok" — so
        `eval check` passes immediately on the freshly scaffolded folder.
      - starter/.gitkeep (empty file so the directory is committable).

      Refuse to overwrite an existing folder; throw a clear error.

      Add a CLI wrapper at packages/agent-eval/src/cli/init.ts:

        export interface InitCliInput {
          name: string;
          sourceDir?: string;
          kind?: "plan" | "pipeline" | "superintendent" | "experiment";
          targetRepo?: string;
          targetRef?: string;
        }
        export async function runInitCli(input: InitCliInput): Promise<number>;

      Behavior:
      - sourceDir defaults to process.cwd().
      - kind defaults to "plan".
      - Validate name is kebab-case (lowercase letters/digits/dashes,
        starts with a letter). Reject otherwise.
      - After scaffolding, print the relative path to the new folder and
        a one-line "next: poe-code eval check <name>" hint.

      Tests:
      - init.test.ts: scaffolds the expected file set; eval.yaml passes
        schema validation; plan.md frontmatter has correct kind; refuses
        to overwrite; name validation works.
      - cli-init.test.ts: cwd default; kind default; refuses bad names.

      Update src/index.ts re-exports.
    status:
      implement: open
      test: open
      commit: open

  - id: eval-lint
    title: "`poe-code eval lint <path>` — static validation"
    prompt: |
      Add the `lint` command. Runs in milliseconds; catches typos before
      `eval check` clones anything.

      Create packages/agent-eval/src/lint/lint.ts:

        export interface LintIssue {
          severity: "error" | "warning";
          code: string;
          message: string;
          path?: string;          // file/dir the issue concerns
        }
        export interface LintResult {
          evalId: string;
          issues: readonly LintIssue[];
        }
        export async function evalLint(input: {
          sourceDir: string;
          evalId: string;
        }): Promise<LintResult>;

      Checks (all run; return all issues):
      - error E001: eval.yaml missing or fails schema validation.
      - error E002: plan.md missing or fails frontmatter parse.
      - error E003: plan.md frontmatter `kind` not in {"plan","pipeline","superintendent","experiment"}.
      - error E004: oracle/ directory missing.
      - error E005: no scorer.command AND no oracle/tests/*.test.ts files
        (default scorer would have nothing to run).
      - warning W001: oracle/solution/ empty or missing (eval check will fail).
      - warning W002: starter/ directory present but empty.
      - warning W003: budget.wall_clock_ms < 60_000 (likely too short).
      - warning W004: eval.yaml `target.ref` is a branch name like "main"
        (not pinned to a SHA; results may not be reproducible). Suggest
        pinning.

      No filesystem mutation. No spawn. Use memfs-friendly fs calls.

      Add a CLI wrapper at packages/agent-eval/src/cli/lint.ts:

        export interface LintCliInput { evalId?: string; sourceDir?: string }
        export async function runLintCli(input: LintCliInput): Promise<number>;

      Behavior:
      - sourceDir defaults to process.cwd().
      - evalId default: if exactly one eval in source, lint it; else
        lint all evals in source.
      - Render via @poe-code/design-system: one section per eval, group
        errors first then warnings, color-coded.
      - Exit code: 0 when no errors (warnings allowed); 1 when any error
        present.

      Tests:
      - lint.test.ts: feed memfs fixtures covering each E### and W###
        code; assert exactly the expected issues are returned.
      - cli-lint.test.ts: single-eval default; all-evals fallback; exit
        codes.

      Update src/index.ts re-exports.
    status:
      implement: open
      test: open
      commit: open

  - id: cli-and-docs
    title: Register init/check/lint in poe-code CLI + README + QA update
    prompt: |
      Wire the three new commands into the main CLI and document them.

      In packages/agent-eval/src/cli/commands.ts, add three toolcraft
      command definitions:

        poe-code eval init <name>
                  [-C <dir>]
                  [--kind plan|pipeline|superintendent|experiment]    # default plan
                  [--target-repo <git-url>] [--target-ref <ref>]

        poe-code eval check [<eval-id>] [-C <dir>]

        poe-code eval lint [<eval-id>] [-C <dir>]

      Each command delegates to runInitCli / runCheckCli / runLintCli
      from the previous tasks. NO business logic in commands.ts; it just
      maps CLI flags to the CLI-wrapper functions.

      In packages/poe-code/src/cli/ (locate the existing `eval` command
      group from the prior pipeline), add the three sub-commands. The
      group already exists from the harness; this task adds three
      children. Confirm `poe-code eval --help` shows all five commands
      (run, report, init, check, lint).

      Update packages/agent-eval/README.md:
      - Replace the "Authoring an eval" section with the new flow:
          poe-code eval init my-task
          cd my-task
          # edit plan.md, oracle/tests/, oracle/solution/
          poe-code eval check .
          poe-code eval lint .
      - Document the vitest scorer convention: tests live in
        oracle/tests/, get CLONE_DIR and ORACLE_DIR env vars, run via
        vitest run automatically.
      - Document the escape hatch: set scorer.command in eval.yaml when
        you need a non-vitest scorer (Python target, cargo test, etc.).
      - Add a small example test (same shape as the init template).
      - Document per-case output in result.json under `tests.cases`.

      Update packages/agent-eval/qa/run-one.md to use the new flow:
      step 1 becomes `poe-code eval init`, step 2 becomes
      `poe-code eval check`, etc. Existing run/report steps stay at the
      end.

      Visual check:
          npm run screenshot-poe-code -- eval --help
          npm run screenshot-poe-code -- eval init --help
          npm run screenshot-poe-code -- eval check --help
          npm run screenshot-poe-code -- eval lint --help
      Save under packages/agent-eval/scripts/screenshots/. Confirm
      design-system style.

      Tests:
      - cli.test.ts additions: flag parsing for init/check/lint;
        required vs optional flags; defaults.

      Do not modify the root README without explicit user permission.
    status:
      implement: open
      test: open
      commit: open

teardown:
  prompt: |
    Run the package's full test suite
    (`npm test --workspace=@poe-code/agent-eval`), then commit any
    remaining changes. Confirm `poe-code eval --help` lists all five
    commands.
---

# Context

Source design notes lived briefly as `kind: plan` in this same file
before being replaced with this pipeline — see git history for the
level-1 rationale.

What changes for eval authors after these tasks land:

- `oracle/` standardizes to `oracle/tests/` + `oracle/solution/`.
- `eval.yaml`'s `scorer` block is optional. Omit it to use the built-in
  vitest runner; provide it only when you need a non-vitest scorer.
- Tests are vanilla vitest. They receive `process.env.CLONE_DIR` and
  `process.env.ORACLE_DIR`. No special test API to learn.
- `result.json` gains `tests.cases: CaseResult[]` so failures are
  legible without re-running.
- Three new CLI commands:
    poe-code eval init <name>       # scaffold a lint-clean folder
    poe-code eval check [<id>]      # run scorer vs reference solution; no agent
    poe-code eval lint  [<id>]      # static validation in ms
- The full inner loop becomes:
    poe-code eval init my-task
    cd my-task
    # edit plan.md, oracle/tests/, oracle/solution/
    poe-code eval check .
    poe-code eval lint .

Invariants preserved from the existing harness:

- Agent's `cwd = cloneDir`; eval source is not mounted into the clone;
  the `outside-clone` cheating filter remains defense in depth.
- `--agent` / `--model` required on `eval run`. No defaults.
- `--repeats` defaults to 3; report aggregates as `mean ±(max−min)/2`.
- No zod; `toolcraft-schema` for `eval.yaml`. No regex on user input.
- Sequential only.
