# @poe-code/experiment-loop

Karpathy-style autonomous experiment loop. An agent makes a change, a metric script scores it, the loop keeps or discards via git, logs to a journal, and repeats.

## Quickstart

```bash
# 1. Install the experiment skill
poe-code experiment install

# 2. Create an experiment doc using /poe-code-experiment-plan
#    e.g. "create experiment to optimize test duration"

# 3. Run the loop
poe-code experiment run

# 4. Check results
poe-code experiment journal
```

## Example Experiment Doc

A markdown file with YAML frontmatter. The body is the agent's research brief.

```yaml
---
agent: claude-code
metric:
  name: tests
  direction: maximize
baseline: null
status:
  state: open
  experiment: 0
  kept: 0
---
# Make the test suite faster

Reduce test execution time without removing coverage.
Focus on parallelization and removing unnecessary setup/teardown.
```

### Multiple agents

Agents cycle round-robin across experiments:

```yaml
agent:
  - claude-code
  - codex
```

From the CLI: `poe-code experiment run --agent claude-code,codex`

### Specifying a model

Use `agent:provider/model` notation:

```yaml
agent: claude-code:anthropic/claude-opus-4.7
```

## Metric Scripts

Metric scripts decide what "better" means. Each must exit 0 on success and print a single number to stdout.

Register them as `metric:*` npm scripts:

```json
{
  "scripts": {
    "metric:tests": "node scripts/metric-test-count.mjs",
    "metric:test_duration": "node scripts/metric-test-duration.mjs"
  }
}
```

### Direction

- `maximize` — higher is better (test count, coverage)
- `minimize` — lower is better (duration, bundle size)
- `stable` — must not change (test count during optimization)

Experiment documents validate prompt text, metric directions, baseline numbers,
agent frontmatter, supported document versions, and stable-metric deltas before
the loop runs. Completion callbacks are awaited before the run command returns.

### Metric chains

All metrics must pass, scores are tracked independently:

```yaml
metric:
  - name: tests
    direction: maximize
  - name: test_duration
    direction: minimize
```

## How It Works

```
measure baseline -> loop:
  agent makes a change -> commit -> run metrics -> keep or discard -> journal -> repeat
```

The agent learns from past attempts through the journal — it sees what worked and what didn't.

## Custom Experiment Directory

By default experiment docs are discovered from the shared plan directory, `docs/plans`.
To use a different directory:

```bash
# Set plan directory in project config (.poe-code/config.json)
# { "plan": { "plan_directory": "docs/experiments" } }

# Or via env
POE_PLAN_DIRECTORY=docs/experiments poe-code experiment run

# Or point to a specific doc directly
poe-code experiment run docs/experiments/optimize-tests.md
```

## Dashboard Configuration

Experiment runs can use the live terminal dashboard.

```bash
# One-off flags
poe-code experiment run --tui
poe-code experiment run --no-tui

# Config default (.poe-code/config.json)
# { "experiment": { "tui": true } }

# Env override
POE_EXPERIMENT_TUI=true poe-code experiment run
```

## CLI

```bash
poe-code experiment run [doc]       [--agent <name>] [--max-experiments <n>] [--tui|--no-tui] [--worktree]
poe-code experiment validate [doc]
poe-code experiment journal [doc]
poe-code experiment install
```

Pass `--worktree` to run the whole experiment loop in one managed git worktree and reconcile successful output afterward. Worktree mode requires a clean source checkout before the run starts.
