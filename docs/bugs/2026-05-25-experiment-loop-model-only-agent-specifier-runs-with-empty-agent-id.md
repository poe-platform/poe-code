# Experiment loop model-only agent specifier runs with empty agent id

## Summary

The exported `@poe-code/experiment-loop` workflow accepts an experiment document agent specifier containing only a model, such as `:openai/gpt-5.4`. Instead of rejecting the missing agent identifier, `runExperimentLoop()` executes an experiment by invoking its configured `runAgent()` implementation with `agent: ""` and `model: "openai/gpt-5.4"`.

## Reproduction

Create a disposable Vitest probe at `packages/experiment-loop/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  agentMakesChanges,
  createExperimentDoc,
  createExperimentLoopSimulation,
  metricResult
} from "./testing/simulation.js";

describe("experiment-loop model-only agent specifier", () => {
  it("runs an experiment with an empty agent id and inline model", async () => {
    const sim = createExperimentLoopSimulation({
      docContent: createExperimentDoc({
        agent: ":openai/gpt-5.4",
        baseline: { tests: 1 }
      }),
      files: { "src/index.ts": "export const value = 1;\n" },
      maxExperiments: 1,
      turns: [agentMakesChanges({ "src/index.ts": "export const value = 2;\n" })],
      metricResults: { "node scripts/metric-tests.mjs": metricResult({ score: 2 }) }
    });

    const { result, runs } = await sim.run();

    expect(result).toMatchObject({ experimentsCompleted: 1, experimentsKept: 1 });
    expect(runs[0]).toMatchObject({ agent: "", model: "openai/gpt-5.4" });
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/experiment-loop/src/__probe__.test.ts
```

## Observed Behavior

The malformed experiment document executes a kept experiment while recording an empty agent identifier with a non-empty model override:

```text
✓ packages/experiment-loop/src/__probe__.test.ts > experiment-loop model-only agent specifier > runs an experiment with an empty agent id and inline model
```

The passing assertion confirms that the captured execution input is equivalent to:

```json
{"agent":"","model":"openai/gpt-5.4"}
```

`normalizeAgents()` in `packages/experiment-loop/src/run/loop.ts` validates only that an `agent` frontmatter value exists and that an array is not empty, then delegates every entry to `parseAgentSpecifier()`. The shared parser in `packages/agent-defs/src/specifier.ts` accepts `:openai/gpt-5.4` by returning an empty `agent` component with a populated `model`. During the experiment iteration, `runExperimentLoop()` forwards `currentSpecifier.agent` directly to both `onExperimentStart()` and the public `runAgent()` callback, so the missing identity is not rejected before execution.

## Expected Behavior

Experiment document validation should reject inline agent specifiers whose agent portion is empty before an experiment starts. A model suffix may override a valid agent, but it must not create an executable experiment entry with no agent identity.

## Impact

Malformed or generated experiment documents can execute autonomous changes with an empty agent identifier while the loop records the attempt as completed and may retain its filesystem modifications as a successful experiment. Depending on the configured runner, this can dispatch an unintended default agent/provider, fail only after candidate changes are made, or produce misleading experiment logs that cannot identify the executing agent.
