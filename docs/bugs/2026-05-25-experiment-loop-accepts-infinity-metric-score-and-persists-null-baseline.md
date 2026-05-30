---
name: "Experiment loop accepts Infinity metric score and persists null baseline"
---

# Experiment loop accepts Infinity metric score and persists null baseline

## Summary

`@poe-code/experiment-loop` accepts the non-finite numeric text `Infinity` as a passing metric score. When that successful score is stored in a journal entry, ordinary JSON serialization changes it to `null`, so the experiment can be accepted using a score that cannot be faithfully persisted or reused as its recorded baseline.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/experiment-loop/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluator/evaluator.js";
import { ExperimentJournal } from "./journal/journal.js";

describe("non-finite experiment metric scores", () => {
  it("accepts Infinity as passing and persists it as null in the journal", async () => {
    const result = await evaluate("score", "/repo", async () => ({
      stdout: "Infinity\n",
      stderr: "",
      exitCode: 0
    }));
    let persisted = "";
    const journal = new ExperimentJournal("/repo/run.journal.jsonl", {
      async mkdir() {},
      async readFile() { return persisted; },
      async writeFile(_path, content) { persisted = content; },
      async appendFile(_path, content) { persisted += content; },
      async readdir() { return []; },
      async stat() { throw new Error("unused"); }
    });

    await journal.log({
      commit: "abc123",
      status: "keep",
      scores: { quality: result.score! },
      output: "quality: Infinity",
      agentOutput: "",
      durationMs: 1,
      timestamp: "2026-05-25T00:00:00.000Z"
    });

    console.log(JSON.stringify({ score: String(result.score), passed: result.passed, persisted }));
    expect(result).toEqual({ score: Infinity, passed: true, output: "Infinity\n" });
    expect(persisted).toContain('"scores":{"quality":null}');
  });
});
PROBE
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm packages/experiment-loop/src/__probe__.test.ts
```

Output:

```text
{"score":"Infinity","passed":true,"persisted":"{\"commit\":\"abc123\",\"status\":\"keep\",\"scores\":{\"quality\":null},\"output\":\"quality: Infinity\",\"agentOutput\":\"\",\"durationMs\":1,\"timestamp\":\"2026-05-25T00:00:00.000Z\"}\n"}
✓ packages/experiment-loop/src/__probe__.test.ts > non-finite experiment metric scores > accepts Infinity as passing and persists it as null in the journal
```

## Observed Behavior

`parseScore()` in `packages/experiment-loop/src/evaluator/evaluator.ts:8` through `packages/experiment-loop/src/evaluator/evaluator.ts:22` converts the metric's last output line with `Number(...)` and rejects only `NaN`; `Number("Infinity")` is therefore returned as a usable score. `runMetric()` at `packages/experiment-loop/src/evaluator/evaluator.ts:29` through `packages/experiment-loop/src/evaluator/evaluator.ts:50` marks that result as passing when the metric exits `0`. `ExperimentJournal.log()` at `packages/experiment-loop/src/journal/journal.ts:26` through `packages/experiment-loop/src/journal/journal.ts:29` persists entries with `JSON.stringify()`, which serializes `Infinity` as `null`. The reproduction shows a successful score of `Infinity` recorded as `{"quality":null}`.

## Expected Behavior

Metric evaluation should accept only finite numeric scores that can be preserved in the journal and baseline model. Non-finite output such as `Infinity` or `-Infinity` should fail metric parsing rather than being treated as a successful experiment score.

## Impact

An erroneous metric script can cause an experiment to be kept based on an impossible score while corrupting its persisted history into a `null` score. Subsequent resume, baseline comparison, or human review sees data inconsistent with the decision already made, undermining experiment selection and reproducibility.
