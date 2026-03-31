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
  assets/
    SKILL_experiment.md
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
  commitAll(message: string, cwd: string): Promise<string>; // returns short hash
  reset(commitHash: string, cwd: string): Promise<void>;
  currentHash(cwd: string): Promise<string>;
}

type ExecFn = (
  command: string,
  options?: {
    cwd?: string;
    timeout?: number;
  }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

type MetricDirection = "minimize" | "maximize";

interface MetricDef {
  name: string; // npm script name (without metric: prefix)
  direction: MetricDirection;
}
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
  maxExperiments?: number; // undefined = infinite
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

Metric scripts are npm scripts with a `metric:` prefix in `package.json`.
The loop runs `npm run metric:<name>` for each entry.

Every metric script must:

- Exit 0 on success, non-zero on crash/error
- Print a single number to stdout (the score)

The loop compares the score against `baseline` in frontmatter.
`direction` controls whether higher or lower is better.

Frontmatter:

```yaml
# single metric
metric:
  name: test_duration
  direction: minimize

# chain — all must exit 0, scores from each are tracked independently
metric:
  - name: tests
    direction: maximize
  - name: test_duration
    direction: minimize
```

### package.json

```json
{
  "scripts": {
    "metric:tests": "npm test",
    "metric:test_duration": "node scripts/metric-test-duration.mjs",
    "metric:bundle_size": "node scripts/metric-bundle-size.mjs"
  }
}
```

### Evaluator contract

```typescript
interface EvalResult {
  score: number; // parsed from stdout
  passed: boolean; // exit 0 = true
  output: string; // raw stdout + stderr, logged to journal
}

async function evaluate(metric: string, cwd: string, exec: ExecFn): Promise<EvalResult>;

async function evaluateChain(
  metrics: MetricDef[],
  cwd: string,
  exec: ExecFn
): Promise<EvalResult[]>;
```

Resolves each metric name to `npm run metric:<name>`.
Run in order. Short-circuit on non-zero exit.
Parse last non-empty line of stdout as the score. If it fails to parse as a `Number`, treat as a `crash`/failure.

### Examples

**Tests pass/fail** — script outputs 1 (pass) or 0 (fail), direction maximize:

```yaml
metric:
  name: tests
  direction: maximize
```

```json
{ "scripts": { "metric:tests": "npm test && echo 1 || echo 0" } }
```

**Benchmark with comparison** — the script owns the comparison logic:

```yaml
metric: test_duration
```

```json
{ "scripts": { "metric:test_duration": "node scripts/metric-test-duration.mjs" } }
```

```javascript
// scripts/metric-test-duration.mjs

async function measure() {
  // replace with actual measurement — return a number
}

const result = await measure();
console.log(result); // the loop reads this as the score
```

**Agent-as-judge** — metric script reads files and passes them to an agent:

```json
{ "scripts": { "metric:readme-ux": "node scripts/metric-readme-ux.mjs" } }
```

```javascript
// scripts/metric-readme-ux.mjs
import { readFileSync } from "node:fs";
import { spawn } from "poe-code";

const readme = readFileSync("README.md", "utf8");
const helpOutput = readFileSync(".metric-cache-help-output.txt", "utf8");

const prompt = `You are a developer who wants to configure a coding agent using poe-code.
You have the README and the --help output below.

Rate the experience from 1-100.
- Can you figure out how to get started?
- Are the steps clear and in the right order?
- Is anything confusing or missing?
Output ONLY a single number, nothing else.

## README
${readme}

## CLI help output
${helpOutput}`;

const { result } = spawn("claude-code", prompt);
const { stdout } = await result;
console.log(stdout.trim()); // the loop reads this as the score
```

**Gate then optimize:**

```yaml
metric:
  - tests
  - test_duration
```

Tests must pass first. If they do, benchmark runs and decides keep/discard.

## Frontmatter

Experiment doc is markdown with YAML frontmatter:

```yaml
---
agent: claude-code
install: npm install
metric:
  name: tests
  direction: maximize
baseline: Record<string, number> | null;
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

Append-only JSONL file at `{docDir}/{docName}.journal.jsonl`. Not committed to git.

```jsonl
{"commit":"a1b2c3d","status":"keep","score":1.04,"output":"test_duration: 1.04","durationMs":5023,"timestamp":"2026-03-30T10:00:00.000Z"}
{"commit":"e4f5g6h","status":"crash","score":null,"output":"SyntaxError: unexpected token","durationMs":102,"timestamp":"2026-03-30T10:05:30.000Z"}
{"commit":"f7g8h9i","status":"discard","score":1.12,"output":"test_duration: 1.12","durationMs":4987,"timestamp":"2026-03-30T10:11:00.000Z"}
```

```typescript
class ExperimentJournal {
  constructor(journalPath: string, fs: ExperimentFileSystem);
  async log(entry: JournalEntry): Promise<void>;
  async readAll(): Promise<JournalEntry[]>;
  async format(): Promise<string>; // human-readable for agent prompt injection
}

interface JournalEntry {
  commit: string;
  status: "keep" | "discard" | "crash";
  score: number | null; // null on crash
  output: string; // raw stdout from eval script
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

- `commitAll`: `git add -A`, unstage the experiment doc, then `git commit -m "..."` → short hash. No changes = return current hash.
- If no changes are detected, log a `no_changes` status to the journal and continue.
- `reset`: `git reset --hard {hash}`, then re-write frontmatter to disk (since reset clobbers it).
- Shell-escape commit messages.

## Core loop

```text
parse doc (frontmatter + body)
record baseline hash
init journal

LOOP:
  build prompt:
    - doc body (the agent's research brief)
    - journal contents (so agent learns from past attempts)
    - editable/readonly file hints
    - last crash output if previous experiment crashed (for self-repair)
    - "you are autonomous, do not stop or ask for input"

  onExperimentStart()
  record pre-experiment hash

  spawn agent
  if agent crashed (non-zero exit):
    journal.log("crash", output), git.reset(), continue

  git.commitAll()

  if frontmatter.install is defined:
    run install command
    if install fails:
      journal.log("crash", "Install failed: ...")
      git.reset()
      continue

  results = evaluateChain(metrics)

  if all passed and all scores improved vs baseline:
    journal.log("keep", scores)
    update baseline in frontmatter (frontmatter is NOT committed to git)
  else:
    journal.log("discard", scores), git.reset()

  onExperimentComplete()
  update frontmatter (experiment count, kept count)
```

- Journal is injected into agent prompt so it learns from past attempts
- Crash output is fed back so the agent can self-repair
- Frontmatter updates are written to disk but NOT committed — git history stays clean (only agent code changes)
- Never stops unless maxExperiments reached or signal aborted

## CLI

```text
poe-code experiment run [doc]
  --agent <agent>          override frontmatter agent
  --model <model>          override frontmatter model
  --max-experiments <n>    limit experiments (default: unlimited)
  --yes                    accept defaults

poe-code experiment journal [doc]
  displays journal as table

poe-code experiment install
  --agent <name>           agent to install the skill for
  --local                  install project-local skill and files (default)
  --global                 install user-global skill and files
  --force                  overwrite existing files

  Installs the 'poe-code-experiment-plan' skill using `@poe-code/agent-skill-config`
  and scaffolds the `.poe-code/experiments/` (local) or `~/.poe-code/experiments/` (global) directory.
```

Discovery from `.poe-code/experiments/` when doc not specified.

## Skill: `poe-code-experiment-plan`

Skill at `.claude/skills/poe-code-experiment-plan/SKILL.md`.
Triggers on: create experiment, experiment plan, karpathy loop.

Creates two things:

1. Experiment doc at `.poe-code/experiments/<name>.md`
2. Metric script(s) that output a number to stdout

### Flow

- If request is empty, ask what to optimize/fix
- Write the experiment doc with frontmatter
- Create metric script(s) — could be:
  - An npm script (`metric:tests` in package.json)
  - A standalone JS file (`scripts/metric-test-duration.mjs`)
  - A shell script (`scripts/metric-bundle-size.sh`)
  - Any executable that prints a number to stdout

### Output

```text
Created:
  .poe-code/experiments/<name>.md
  scripts/metric-<name>.mjs  (if needed)

Run with:
  poe-code experiment run .poe-code/experiments/<name>.md
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
9. Verification
