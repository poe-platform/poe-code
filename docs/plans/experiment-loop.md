# Experiment Loop

Karpathy-style autonomous experiment loop for poe-code.
Agent makes a change → eval script runs → keep or discard via git → log to journal → repeat.

## Package: `packages/experiment-loop`

New orchestration package alongside ralph and pipeline.

### File structure

```
packages/experiment-loop/
  src/
    types.ts
    index.ts
    frontmatter/
      frontmatter.ts
      frontmatter.test.ts
    journal/
      journal.ts
      journal.test.ts
    evaluator/
      evaluator.ts
      evaluator.test.ts
    git/
      git.ts
      git.test.ts
    run/
      loop.ts
    testing/
      index.ts
      simulation.ts
      simulation.test.ts
```

## Types

Same abstraction pattern as ralph/pipeline — `fs`, `git`, and `exec` are injectable for testing.

```typescript
interface ExperimentFileSystem {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ isFile(): boolean; mtimeMs: number }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
}

interface ExperimentGit {
  commitAll(message: string, cwd: string): Promise<string>;  // returns short hash
  reset(commitHash: string, cwd: string): Promise<void>;
  currentHash(cwd: string): Promise<string>;
  createBranch(name: string, cwd: string): Promise<void>;
  currentBranch(cwd: string): Promise<string>;
}

type ExecFn = (command: string, options?: {
  cwd?: string; timeout?: number;
}) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
```

### Agent types (same as ralph)

```typescript
interface AgentRunInput {
  agent: string;
  prompt: string;
  cwd: string;
  model?: string;
  signal?: AbortSignal;
}

interface AgentRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}
```

### Run options and result

```typescript
interface ExperimentRunOptions {
  cwd: string;
  homeDir: string;
  docPath: string;
  maxExperiments?: number;          // undefined = infinite
  fs?: ExperimentFileSystem;
  git?: ExperimentGit;
  exec?: ExecFn;
  runAgent?: (input: AgentRunInput) => Promise<AgentRunResult>;
  onExperimentStart?: (index: number, agent: string) => void;
  onExperimentComplete?: (index: number, entry: JournalEntry) => void;
  signal?: AbortSignal;
}

type ExperimentStopReason = "max_experiments" | "cancelled";

interface ExperimentRunResult {
  stopReason: ExperimentStopReason;
  docPath: string;
  experimentsCompleted: number;
  experimentsKept: number;
  totalDurationMs: number;
}
```

## Metric scripts

**The eval script is the oracle. Exit 0 = keep, non-zero = discard.**

The loop doesn't interpret stdout, parse numbers, or understand what "improvement" means.
The script owns the domain logic — it decides whether the result is good enough.

Frontmatter:

```yaml
# single script
metric: "npm test"

# chain — all must exit 0 to keep
metric:
  - "npm test"
  - "./benchmark.sh"
```

Just strings. No mode, no direction, no objects.

### Evaluator contract

```typescript
interface EvalResult {
  passed: boolean;   // exit 0 = true
  output: string;    // stdout + stderr, logged to journal
}

async function evaluate(
  metric: string | string[],
  cwd: string,
  exec: ExecFn
): Promise<EvalResult>;
```

Run each command in order. Short-circuit on non-zero exit. Return combined output.

### Examples

**Tests pass/fail:**
```yaml
metric: "npm test"
```

**Benchmark with comparison** — the script owns the comparison logic:
```bash
#!/bin/bash
# benchmark.sh
RESULT=$(node bench.js | tail -1)
BASELINE=$(cat .baseline 2>/dev/null || echo 999)
if (( $(echo "$RESULT < $BASELINE" | bc -l) )); then
  echo "$RESULT" > .baseline
  echo "improved: $BASELINE → $RESULT"
  exit 0
else
  echo "no improvement: $RESULT >= $BASELINE"
  exit 1
fi
```

**Gate then optimize:**
```yaml
metric:
  - "npm test"
  - "./benchmark.sh"
```
Tests must pass first. If they do, benchmark runs and decides keep/discard.

## Frontmatter

Experiment doc is markdown with YAML frontmatter:

```yaml
---
agent: claude-code
metric: "npm test"
branch: experiment/mar30
editable:
  - src/model.py
readonly:
  - src/data.py
model: claude-sonnet-4-20250514
status:
  state: open
  experiment: 0
  kept: 0
---
# Your experiment instructions here
```

Functions: `parseExperimentFrontmatter`, `writeExperimentFrontmatter`.
Same library as ralph (gray-matter).

## Journal

Append-only TSV file at `{docDir}/journal.tsv`. Not committed to git.

```
commit	status	output	duration_ms	timestamp
a1b2c3d	keep	improved: 1.10 → 1.04	5023	2026-03-30T10:00:00.000Z
e4f5g6h	crash	SyntaxError: unexpected token	102	2026-03-30T10:05:30.000Z
f7g8h9i	discard	no improvement: 1.12 >= 1.04	4987	2026-03-30T10:11:00.000Z
```

```typescript
class ExperimentJournal {
  constructor(journalPath: string, fs: ExperimentFileSystem);
  async log(entry: JournalEntry): Promise<void>;
  async readAll(): Promise<JournalEntry[]>;
  async format(): Promise<string>;  // human-readable for agent prompt injection
}

interface JournalEntry {
  commit: string;
  status: "keep" | "discard" | "crash";
  output: string;      // stdout from eval script
  durationMs: number;
  timestamp: string;
}
```

- Creates header on first write
- `format()` returns the TSV content for injection into agent prompt

## Git strategy

```typescript
function createDefaultGit(exec: ExecFn): ExperimentGit;
```

- `commitAll`: `git add -A && git commit -m "..."` → short hash. No changes = return current hash.
- `reset`: `git reset --hard {hash}`
- `createBranch`: `git checkout -b {name}`
- Shell-escape commit messages.

## Core loop

```
parse doc (frontmatter + body)
if branch specified: create/checkout branch
record baseline hash
init journal

LOOP:
  build prompt = doc body + journal contents + editable/readonly hints
  onExperimentStart()
  record pre-experiment hash

  spawn agent
  if agent crashed (non-zero exit):
    journal.log("crash"), git.reset(), continue

  git.commitAll()
  result = evaluate(metric scripts)

  if result.passed:
    journal.log("keep")
  else:
    journal.log("discard"), git.reset()

  onExperimentComplete()
  update frontmatter (experiment count, kept count)
```

- Journal is injected into agent prompt so it learns from past attempts
- Never stops unless maxExperiments reached or signal aborted
- Crash recovery: log and continue

## CLI

```
poe-code experiment run [doc]
  --agent <agent>          override frontmatter agent
  --model <model>          override frontmatter model
  --max-experiments <n>    limit experiments (default: unlimited)
  --yes                    accept defaults

poe-code experiment journal [doc]
  displays journal as table
```

Discovery from `.poe-code/experiments/` when doc not specified.

## SDK

`src/sdk/experiment.ts` re-exports public API. Added to `src/index.ts` barrel.

```typescript
import { runExperimentLoop } from "poe-code";
```

## Testing

Simulation harness (memfs + mock git + mock exec) following ralph pattern.

Key test scenarios:
1. Single script — keep (exit 0)
2. Single script — discard (exit 1)
3. Chain — all pass → keep
4. Chain — first fails → short-circuit, discard
5. Chain — second fails → discard
6. Agent crash — logged and continued
7. Journal injected into prompt
8. Abort signal — cancels loop

## Implementation order

1. Types + package scaffolding
2. Frontmatter parsing
3. Journal
4. Evaluator
5. Git strategy
6. Core loop
7. Simulation harness + tests
8. CLI command
9. SDK exports
10. Verification
