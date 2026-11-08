---
kind: experiment
version: 1
agents:
  experimenter:
    agent: claude-code
    mode: edit
    prompt: |
      Make one focused attempt to improve the target metric.
metric:
  name: tests
  direction: maximize
maxKept: 2
---

# Experiment loop

This example evaluates metrics and selects successful attempts in a single markdown
harness file. Attempt selection does not commit or roll back repository changes.

```js
import { spawn } from "agent";
import { agents, meta } from "harness";
import { event } from "log";
import { run as runMetric } from "metric";

const metricName = meta.frontmatter.metric.name;
const baseline = await runMetric(metricName);
const maxKept = meta.frontmatter.maxKept ?? 2;
const summarizeAttempts = (attempts) =>
  attempts
    .map((attempt) => `${attempt.event}:${attempt.attempt}:${attempt.score ?? "n/a"}`)
    .join("\n");

const runLoop = async (kept, attempts) => {
  if (kept >= maxKept) {
    return {
      kind: meta.kind,
      kept,
      baseline
    };
  }

  const attemptNumber = attempts.length + 1;
  const result = await spawn(agents.experimenter, {
    check: true,
    prompt: `Attempt ${attemptNumber}\n\n${summarizeAttempts(attempts)}`
  });
  const score = await runMetric(metricName);

  if (score >= baseline) {
    event("attempt.kept", {
      attempt: attemptNumber,
      score,
      summary: result.summary
    });
    return await runLoop(
      kept + 1,
      attempts.concat({ event: "kept", attempt: attemptNumber, score })
    );
  }

  event("attempt.discarded", {
    attempt: attemptNumber,
    score
  });
  return await runLoop(
    kept,
    attempts.concat({ event: "discarded", attempt: attemptNumber, score })
  );
};

return await runLoop(0, []);
```
