---
kind: pipeline
version: 1
tasks:
  - id: scaffold-package
    title: Scaffold experiment-loop package with types
    prompt: >
      Create the `packages/experiment-loop` package following the same patterns as
      `packages/pipeline`.


      Plan: `docs/plans/experiment-loop.md`


      1. Create `packages/experiment-loop/package.json` with:
         - name: `@poe-code/experiment-loop`
         - Same devDependencies pattern as `packages/pipeline/package.json`
         - Add `gray-matter` dependency (for frontmatter parsing, same as ralph)
      2. Create `packages/experiment-loop/tsconfig.json` matching pipeline's tsconfig

      3. Create `packages/experiment-loop/README.md` with a short description

      4. Create `packages/experiment-loop/src/types.ts` with all interfaces from the plan:
         - `ExperimentFileSystem` (readFile, writeFile, readdir, stat, mkdir, appendFile)
         - `ExperimentGit` (commitAll, reset, currentHash)
         - `ExecFn` type
         - `MetricDirection` ("minimize" | "maximize")
         - `MetricDef` (name, direction)
         - `AgentRunInput` / `AgentRunResult` (same as ralph)
         - `ExperimentRunOptions` (cwd, homeDir, docPath, maxExperiments, fs, git, exec, runAgent, callbacks, signal)
         - `ExperimentStopReason` / `ExperimentRunResult`
         - `JournalEntry` (commit, status, score, output, durationMs, timestamp)
      5. Create `packages/experiment-loop/src/index.ts` that re-exports public API (empty for now,
      will be filled as modules are built)

      6. Add the package to the root `package.json` workspaces if not already covered by glob

      7. Run `npm install` to link the new package


      Reference `packages/pipeline/package.json` and `packages/pipeline/src/types.ts` for
      conventions.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: frontmatter
    title: Implement frontmatter parsing and serialization
    prompt: >
      Implement frontmatter parsing for experiment docs in `packages/experiment-loop`.


      Plan: `docs/plans/experiment-loop.md` (Frontmatter section)


      Create `packages/experiment-loop/src/frontmatter/frontmatter.ts` with:

      - `parseExperimentFrontmatter(content: string)` — parses markdown with YAML frontmatter using
      `gray-matter`
        - Returns typed frontmatter: agent, metric (single MetricDef or MetricDef[]), baseline (Record<string, number> | null), editable, readonly, model, status (state, experiment, kept)
        - Returns body (markdown content after frontmatter)
      - `writeExperimentFrontmatter(docPath: string, frontmatter: object, body: string, fs:
      ExperimentFileSystem)` — serializes frontmatter + body back to markdown file


      Create `packages/experiment-loop/src/frontmatter/frontmatter.test.ts` with tests:

      - Parse single metric with direction

      - Parse metric chain (array of MetricDef)

      - Parse baseline as Record<string, number>

      - Parse baseline as null

      - Round-trip: parse then write produces equivalent output

      - All frontmatter fields present and correctly typed


      Use `memfs` for filesystem in tests. Follow TDD — write tests first.

      Reference types from `packages/experiment-loop/src/types.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: journal
    title: Implement append-only JSONL journal
    prompt: >
      Implement the experiment journal in `packages/experiment-loop`.


      Plan: `docs/plans/experiment-loop.md` (Journal section)


      Create `packages/experiment-loop/src/journal/journal.ts` with class `ExperimentJournal`:

      - Constructor takes `journalPath: string` and `fs: ExperimentFileSystem`

      - `log(entry: JournalEntry): Promise<void>` — appends JSON line to journal file. Creates file
      on first write.

      - `readAll(): Promise<JournalEntry[]>` — reads and parses all lines. Returns empty array if
      file doesn't exist.

      - `format(): Promise<string>` — returns human-readable TSV content for injection into agent
      prompt


      JournalEntry fields: commit, status ("keep" | "discard" | "crash"), score (number | null),
      output, durationMs, timestamp.


      Journal path convention: `{docDir}/{docName}.journal.jsonl` (not committed to git).


      Create `packages/experiment-loop/src/journal/journal.test.ts` with tests:

      1. Log single entry and read it back

      2. Log multiple entries, readAll returns all in order

      3. readAll on missing file returns empty array

      4. format() returns readable table

      5. Handles crash entries (score: null)


      Use `memfs` for filesystem. Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: evaluator
    title: Implement metric evaluator
    prompt: |
      Implement the metric evaluator in `packages/experiment-loop`.

      Plan: `docs/plans/experiment-loop.md` (Evaluator section)

      Create `packages/experiment-loop/src/evaluator/evaluator.ts` with:
      - `evaluate(metric: string, cwd: string, exec: ExecFn): Promise<EvalResult>`
        - Runs `npm run metric:<name>` via exec
        - Parses last non-empty line of stdout as a number (the score)
        - If parsing fails, treat as crash/failure (passed: false, score: null)
        - Returns `{ score, passed (exit 0 = true), output (raw stdout + stderr) }`
      - `evaluateChain(metrics: MetricDef[], cwd: string, exec: ExecFn): Promise<EvalResult[]>`
        - Runs metrics in order
        - Short-circuits on first non-zero exit (returns results so far)

      Create `packages/experiment-loop/src/evaluator/evaluator.test.ts` with tests:
      1. Single metric — exit 0 with valid number → passed: true, score parsed
      2. Single metric — exit 1 → passed: false
      3. Single metric — stdout is not a number → passed: false, score: null
      4. Chain — all pass → returns all results
      5. Chain — first fails → short-circuits, returns only first result
      6. Chain — second fails → returns first two results
      7. Score parsed from last non-empty line (ignores earlier output)

      Use mock `ExecFn` in tests. Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: git-strategy
    title: Implement git strategy
    prompt: >
      Implement the git strategy in `packages/experiment-loop`.


      Plan: `docs/plans/experiment-loop.md` (Git strategy section)


      Create `packages/experiment-loop/src/git/git.ts` with:

      - `createDefaultGit(exec: ExecFn): ExperimentGit`
        - `commitAll(message, cwd)`: runs `git add -A`, unstages the experiment doc, then `git commit -m "..."`. Returns short hash. If no changes detected, returns current hash.
        - `reset(commitHash, cwd)`: runs `git reset --hard {hash}`. Shell-escapes the commit hash.
        - `currentHash(cwd)`: returns current short commit hash

      Create `packages/experiment-loop/src/git/git.test.ts` with tests:

      1. commitAll stages files and commits, returns hash

      2. commitAll with no changes returns current hash

      3. commitAll unstages the experiment doc from the commit

      4. reset runs git reset --hard with the given hash

      5. currentHash returns short hash

      6. Commit messages are shell-escaped


      Use mock `ExecFn` that records called commands. Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: core-loop
    title: Implement the core experiment loop
    prompt: >
      Implement the core experiment loop in `packages/experiment-loop`.


      Plan: `docs/plans/experiment-loop.md` (Core loop section)


      Create `packages/experiment-loop/src/run/loop.ts` with:

      - `runExperimentLoop(options: ExperimentRunOptions): Promise<ExperimentRunResult>`


      The loop:

      1. Parse doc (frontmatter + body)

      2. Record baseline hash via git.currentHash()

      3. Init journal at `{docDir}/{docName}.journal.jsonl`

      4. LOOP (until maxExperiments reached or signal aborted):
         a. Build prompt: doc body + journal contents + editable/readonly hints + last crash output (if previous crashed) + "you are autonomous, do not stop or ask for input"
         b. Call onExperimentStart callback
         c. Record pre-experiment hash
         d. Spawn agent via runAgent()
         e. If agent crashes (non-zero exit): journal.log("crash"), git.reset(), continue
         f. git.commitAll()
         g. evaluateChain(metrics)
         h. If all passed AND all scores improved vs baseline: journal.log("keep"), update baseline in frontmatter (NOT committed to git)
         i. Else: journal.log("discard"), git.reset()
         j. Call onExperimentComplete callback
         k. Update frontmatter status (experiment count, kept count) — written to disk but NOT committed

      Return: { stopReason, docPath, experimentsCompleted, experimentsKept, totalDurationMs }


      Wire up all modules: frontmatter, journal, evaluator, git.

      Export `runExperimentLoop` from `packages/experiment-loop/src/index.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: simulation-harness
    title: Build simulation test harness and integration tests
    prompt: >
      Build a simulation harness and integration tests for the experiment loop in
      `packages/experiment-loop`.


      Plan: `docs/plans/experiment-loop.md` (Testing section)


      Create `packages/experiment-loop/src/testing/simulation.ts`:

      - Simulation harness with memfs + mock git + mock exec (same pattern as ralph's testing
      harness)

      - Helper to create in-memory experiment docs with frontmatter

      - Mock agent that can be configured to: make changes, crash, or produce specific outputs

      - Mock exec that returns configurable metric results


      Create `packages/experiment-loop/src/testing/index.ts` re-exporting harness utilities.


      Create `packages/experiment-loop/src/testing/simulation.test.ts` with integration tests:

      1. Single metric — keep (agent makes change, metric exit 0, score improves)

      2. Single metric — discard (score doesn't improve)

      3. Chain — all pass → keep

      4. Chain — first fails → short-circuit, discard

      5. Chain — second fails → discard

      6. Agent crash — logged to journal and loop continues

      7. Journal contents injected into agent prompt (verify prompt includes prior entries)

      8. Abort signal — cancels loop, returns "cancelled" stopReason


      These are full loop integration tests using the simulation harness — no real git or
      filesystem.

      Follow TDD.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: cli-command
    title: Add experiment CLI commands
    prompt: |
      Add experiment CLI commands to poe-code.

      Plan: `docs/plans/experiment-loop.md` (CLI section)

      Add two subcommands under `poe-code experiment`:

      `poe-code experiment run [doc]`
        - `--agent <agent>` — override frontmatter agent
        - `--model <model>` — override frontmatter model
        - `--max-experiments <n>` — limit experiments (default: unlimited)
        - `--yes` — accept defaults
        - If `doc` not specified, discover from `.poe-code/experiments/` directory
        - Wire to `runExperimentLoop` from `@poe-code/experiment-loop`
        - Hook up onExperimentStart/onExperimentComplete for CLI output

      `poe-code experiment journal [doc]`
        - Displays journal as a formatted table
        - If `doc` not specified, discover from `.poe-code/experiments/`

      Use `commander` for arg parsing. Follow the same CLI patterns as existing commands.
      Keep parity with SDK — expose the same options programmatically.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: skill
    title: Create poe-code-experiment-plan skill
    prompt: >
      Create the `poe-code-experiment-plan` skill at
      `.claude/skills/poe-code-experiment-plan/SKILL.md`.


      Plan: `docs/plans/experiment-loop.md` (Skill section)


      The skill triggers on: create experiment, experiment plan, karpathy loop.


      It creates two things:

      1. Experiment doc at `.poe-code/experiments/<name>.md` with YAML frontmatter (agent, metric
      with name+direction, baseline: null, editable, readonly, model, status)

      2. Metric script(s) — npm scripts with `metric:` prefix in package.json


      Include:

      - Frontmatter format with all fields from the plan (agent, metric as single or chain with
      name+direction, baseline, editable, readonly, model, status)

      - Metric script patterns: pass/fail (direct npm script), measurement (JS file that prints a
      number), agent-as-judge, gate-then-optimize chain

      - Rules: kebab-case names, scripts in JS not bash, start baseline as null, scope with
      editable/readonly

      - Output format showing created files and run command


      Follow the same SKILL.md structure as `.claude/skills/poe-code-pipeline-plan/SKILL.md`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: verify
    title: End-to-end verification
    prompt: >
      Verify the full experiment-loop implementation works end to end.


      1. Run all unit tests: `npm run test` in `packages/experiment-loop`

      2. Run linting: `npm run lint`

      3. Verify CLI commands register correctly:
         - `npm run dev -- experiment --help` shows run and journal subcommands
         - `npm run dev -- experiment run --help` shows all options
      4. Take screenshots of CLI help output:
         - `npm run screenshot-poe-code -- experiment --help`
         - `npm run screenshot-poe-code -- experiment run --help`
         - `npm run screenshot-poe-code -- experiment journal --help`
      5. Verify the skill is loaded: check that `poe-code-experiment-plan` appears in available
      skills

      6. Fix any issues found


      Do NOT run the actual experiment loop — just verify everything compiles, tests pass, and CLI
      is wired correctly.
    status:
      implement: done
      refactor: done
      test: done
      commit: open
---

# experiment loop

Archived local pipeline plan converted from YAML during docs cleanup.
