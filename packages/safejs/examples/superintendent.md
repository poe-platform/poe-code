---
kind: superintendent
version: 1
agents:
  builder:
    agent: claude-code
    prompt: |
      Build the requested change set.
  security:
    agent: claude-code
    mode: read
    prompt: |
      Review for auth, validation, and secret handling issues.
  perf:
    agent: claude-code
    mode: read
    prompt: |
      Review for regressions and obvious inefficiencies.
  tests:
    agent: claude-code
    mode: read
    prompt: |
      Review the test plan and likely gaps.
  judge:
    agent: claude-code
    mode: read
    prompt: |
      Decide whether the builder output is ready for owner review.
  owner:
    agent: claude-code
    mode: read
    prompt: |
      Final approval gate.
max_rounds: 3
---

# Superintendent loop

This mirrors the superintendent shape: a builder turn, parallel inspectors, a
judge, and an owner check.

```js
import { spawn } from "agent";
import { agents, meta } from "harness";
import fail from "fail";
import { event } from "log";

const inspectors = [agents.security, agents.perf, agents.tests];
const maxRounds = meta.frontmatter.max_rounds ?? 3;

const collectReports = async (index, builder, reports) => {
  if (index >= inspectors.length) {
    return reports;
  }

  const inspector = inspectors[index];
  const report = await spawn(inspector, {
    check: true,
    prompt: `Inspect round ${builder.round}\n\n${builder.summary}`
  });

  return await collectReports(index + 1, builder, reports.concat(report));
};

const runRound = async (round) => {
  if (round >= maxRounds) {
    fail(`max rounds (${maxRounds}) reached without approval`);
  }

  const builder = await spawn(agents.builder, {
    check: true,
    prompt: `Round ${round + 1}: continue from the current plan state.`
  });
  const reports = await collectReports(0, { round: round + 1, summary: builder.summary }, []);
  const verdict = await spawn(agents.judge, {
    check: true,
    prompt: `Judge round ${round + 1}\n\n${reports.map((report) => report.summary).join("\n")}`
  });
  const owner = await spawn(agents.owner, { prompt: verdict.summary, check: true });
  event("round.completed", {
    round: round + 1,
    owner: owner.summary
  });

  return {
    kind: meta.kind,
    rounds: round + 1,
    inspectors: reports.length
  };
};

return await runRound(0);
```
