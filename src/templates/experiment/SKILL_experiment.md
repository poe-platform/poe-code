---
name: poe-code-experiment-plan
description: "Create an experiment plan for the poe-code experiment loop. Triggers on: create experiment, experiment plan, karpathy loop."
---

## If The Request Is Empty

Ask the user what they want to optimize, fix, or measure.

## Goal

Create an experiment doc in the shared plan directory and metric script(s) for the autonomous experiment loop.

## Steps

1. Create an experiment doc at `<plan-directory>/<name>.md` with YAML frontmatter (see Plan Directory section below).
2. Create metric script(s) that output a single number to stdout and add them as `metric:*` npm scripts in `package.json`.

## Frontmatter Format

```yaml
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/experiment.schema.json
kind: experiment
version: 1
agent: claude-code
metric:
  name: <metric_name>
  script: <full command to run in cwd>
  direction: minimize | maximize | stable
  delta: <optional, acceptable variance from baseline>
baseline: null
# Optional:
# max_experiments: 10
# metric_timeout: 120
---
```

Use snake_case for frontmatter fields. Do **not** write runtime state like `status` into the document frontmatter; the journal sidecar is authoritative.

To pin a specific model, use the agent specifier notation `agent:provider/model`:

```yaml
agent: claude-code:<model-id>
```

For multiple metrics, all metrics must pass and scores are tracked independently:

```yaml
metric:
  - name: tests
    script: node scripts/metric-tests.mjs
    direction: maximize
  - name: test_duration
    script: node scripts/metric-test-duration.mjs
    direction: minimize
```

## Metric Scripts

Every metric must have an explicit `script` field: the full command to run in cwd.

The script must:

- Exit 0 on success, non-zero on crash/error
- Print a single number to stdout as the last line (the score)

### Examples

**Pass/fail test gate:**

```yaml
metric:
  name: tests
  script: node scripts/metric-tests.mjs
  direction: maximize
```

```javascript
// scripts/metric-tests.mjs
import { execSync } from "node:child_process";
try {
  execSync("npm test", { stdio: "pipe" });
  console.log(1);
} catch {
  console.log(0);
}
```

**Benchmark measurement:**

```yaml
metric:
  name: test_duration
  script: node scripts/metric-test-duration.mjs
  direction: minimize
```

```javascript
// scripts/metric-test-duration.mjs
const result = await measure();
console.log(result);
```

**Agent-as-judge:**

```yaml
metric:
  name: readme_ux
  script: node scripts/metric-readme-ux.mjs
  direction: maximize
```

```javascript
// scripts/metric-readme-ux.mjs
import { readFileSync } from "node:fs";
import { spawn } from "poe-code";

const readme = readFileSync("README.md", "utf8");
const { result } = spawn("claude-code", `Rate this README 1-100.\n\n${readme}`);
const { stdout } = await result;
console.log(stdout.trim());
```

## Rules

- Each metric script must be idempotent and self-contained.
- Experiment docs live in the plan directory (see Plan Directory section). Default: `docs/plans`.
- Frontmatter fields are snake_case only.
- Use `direction: maximize` when higher scores are better, `direction: minimize` when lower is better, `direction: stable` when the value must not change.
- Use `delta` to allow variance. Without delta, comparisons are strict (must improve or stay equal). With `delta: 5`, a regression up to 5 is tolerated for minimize/maximize, and stable accepts ±5 drift.
- Metric scripts must output raw values, not pass/fail; the loop handles baseline comparison.
- The `baseline` field starts as `null`; the loop measures it automatically before the first experiment.
- Do not add `max_experiments` to the frontmatter unless the user explicitly requests a limit. The loop defaults to unlimited.
- Use `metric_timeout` if the user wants to override the default metric timeout.
- Do not write `status` in frontmatter. Runtime progress belongs in the journal file, not the plan doc.

## After Writing

1. Run `poe-code experiment validate <path>` to check the experiment doc is valid.
2. Run each metric script 3 times (using the exact `script` command from the frontmatter) and record the scores.
3. Check the results:
   - Do the scores make sense for what you're measuring?
   - Is the variance low enough? If scores swing wildly between runs, the metric is too noisy for the loop to distinguish real improvements from random fluctuation.
   - Does the script exit 0 consistently? Flaky failures will cause false discards.
4. If a metric is too noisy, fix it (pin random seeds, increase sample size, average multiple runs inside the script) and re-verify.
5. Report the scores and variance to the user before finishing.

## Output

```text
Created:
  <plan-directory>/<name>.md
  scripts/metric-<name>.mjs  (if needed)

Verification (3 runs):
  metric:<name>  ->  42, 43, 42  (variance: 0.3)  stable

Run with:
  poe-code experiment run <plan-directory>/<name>.md
```
