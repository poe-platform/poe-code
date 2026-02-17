# Ralph Improvements

## 1. Pass `--model` to spawn

**Files:** `src/cli/commands/ralph.ts`, `packages/ralph/src/build/loop.ts`

- Add `--model <model>` option to `ralph build` CLI command
- Add `model?: string` threading from CLI → `ralphBuild()` → `buildLoop()` → `spawn()` call at loop.ts:562
- `BuildLoopOptions` already has `model?: string`, `SpawnFn` already accepts it — just not forwarded

---

## 2. Interactive `--plan` prompt

**Files:** `src/cli/commands/ralph.ts`

- When `planPath` resolves to `null` (line 527), instead of silently returning, prompt the user with a `text()` input for the plan file path
- With `--yes`, throw a `ValidationError` (cannot default a file path)

---

## 3. Wire `--yes` into `ralph build`

**Files:** `src/cli/commands/ralph.ts`

- `flags.assumeYes` is resolved at line 464 but never used in `ralph build`
- Pass it through to the plan prompt (point 2) to skip interactive input

---

## 4. Auto-detect iterations from open stories

**Files:** `src/cli/commands/ralph.ts`

- Plan is already parsed (lines 536–541), `open` story count is available
- Formula: `Math.max(open * 2, open + 10)` — ~2 attempts per story, minimum buffer
- Priority: explicit `[iterations]` arg → auto-detect from plan → config default → hardcoded 25
- Only applies when `iterations` arg is not explicitly passed and no `config.maxIterations`

---

## 5. Per-iteration headline in build loop

**Files:** `packages/ralph/src/build/loop.ts`, `src/cli/commands/ralph.ts`

- `BuildLoopOptions.deps` already has `stdout: { write(chunk) }`
- Before the `spawn()` call (loop.ts:562), write a headline:

  ```
  Iteration 3/25 — Story: Fix login redirect
  ```

- CLI passes `process.stdout` via deps; tests mock it

---

## 6. Summary at end of run

**Files:** `src/cli/commands/ralph.ts`

- Record `Date.now()` before `ralphBuild()` call, diff after
- `BuildResult` already returns `iterationsCompleted` and `storiesDone`
- Display after line 562 using `resources.logger`, e.g.:

  ```
  Iterations:    12/25
  Stories done:  3
  Duration:      4m 32s
  ```
