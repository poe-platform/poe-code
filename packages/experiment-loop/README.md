# @poe-code/experiment-loop

Karpathy-style autonomous experiment loop for poe-code. An agent makes a change, a metric script scores it, the loop keeps or discards via git, logs to a journal, and repeats.

## How it works

```
measure baseline → loop:
  agent makes a change → commit → run metrics → keep or discard → journal → repeat
```

1. The loop measures baseline scores before the first experiment
2. It spawns an agent with the experiment doc + journal history as prompt
3. The agent's changes are committed to git
4. Metric scripts run and produce scores
5. If all scores improve vs baseline: **keep** (update baseline, move on)
6. If any score regresses or a metric crashes: **discard** (git reset)
7. Results are logged to a JSONL journal, which is fed back to the agent

The agent learns from past attempts through the journal — it sees what worked and what didn't.

## Quick start

```bash
# 1. Install the experiment skill for your agent
poe-code experiment install

# 2. Create an experiment doc using the poe-code-experiment-plan skill:
#    "create experiment to optimize test duration"

# 3. Run the loop
poe-code experiment run .poe-code/experiments/<name>.md

# 4. Check results
poe-code experiment journal .poe-code/experiments/<name>.md
```

## Experiment doc

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

The `agent` field accepts an array. Agents are cycled round-robin across experiments:

```yaml
agent:
  - claude-code
  - codex
```

Experiment 1 uses `claude-code`, experiment 2 uses `codex`, experiment 3 back to `claude-code`, and so on.

From the CLI, pass a comma-separated list:

```bash
poe-code experiment run --agent claude-code,codex
```

### Specifying a model

To pin a specific model, use the agent specifier notation `agent:provider/model`:

```yaml
agent: claude-code:anthropic/claude-opus-4.6
```

Each entry in an array can specify its own model:

```yaml
agent:
  - claude-code:anthropic/claude-opus-4.6
  - codex:openai/gpt-5.4
```

When the model part is omitted, the configured default model is used.

## Metric scripts

Metric scripts are the oracle. They decide what "better" means.

Each metric script must:
- Exit 0 on success, non-zero on failure
- Print a single number to stdout

Register them as `metric:*` npm scripts in `package.json`:

```json
{
  "scripts": {
    "metric:tests": "node scripts/metric-test-count.mjs",
    "metric:test_duration": "node scripts/metric-test-duration.mjs"
  }
}
```

### Direction

`direction` tells the loop what "improvement" means for each metric:

- `maximize` — higher is better (test count, coverage). Keep when `score > baseline`.
- `minimize` — lower is better (duration, bundle size). Keep when `score < baseline`.
- `stable` — must not change (test count during optimization). Keep when `score === baseline`.

### Metric chains

Chain multiple metrics — all must pass, scores are tracked independently:

```yaml
metric:
  - name: tests
    direction: maximize
  - name: test_duration
    direction: minimize
```

## Skill: `poe-code-experiment-plan`

Installed via `poe-code experiment install`. Triggers when you ask the agent to "create experiment", "experiment plan", or "karpathy loop".

The skill instructs the agent to:

1. Create an experiment doc at `.poe-code/experiments/<name>.md`
2. Create metric script(s) and register them in `package.json`
3. Run each metric 3 times to verify stability and report variance

## CLI

```
poe-code experiment run [doc]       Run the experiment loop
poe-code experiment validate [doc]  Validate an experiment doc
poe-code experiment journal [doc]   Display the journal as a table
poe-code experiment install         Install the experiment skill
```

## Environment variables

This package does not currently expose any environment variables.

## Configuration

This package does not currently expose any standalone configuration options.

## TODO

- Skill template should be language agnostic (currently assumes npm/JS ecosystem)
- Agent should handle journaling at the end of each task instead of the loop orchestrator
