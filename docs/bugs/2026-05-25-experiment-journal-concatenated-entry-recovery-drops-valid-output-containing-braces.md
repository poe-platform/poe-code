# Experiment journal concatenated-entry recovery drops valid output containing braces

## Summary

`@poe-code/experiment-loop` attempts to recover journal files where valid JSON entries were concatenated on a single line, but its recovery scanner counts every `{` and `}` character without respecting JSON string boundaries. If a normal `output` or `agentOutput` message contains an unmatched brace, valid concatenated journal entries are silently omitted from `readAll()`.

## Reproduction

Run a disposable Vitest probe from the repository root:

```sh
cat > packages/experiment-loop/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { ExperimentJournal } from "./journal/journal.js";

describe("concatenated journal entries containing brace text", () => {
  it("fails to recover valid entries when an output string contains an unmatched brace", async () => {
    const first = {
      commit: "aaa1111",
      status: "keep" as const,
      scores: { tests: 1 },
      output: "printed { while debugging",
      agentOutput: "",
      durationMs: 1,
      timestamp: "2026-05-25T00:00:00.000Z"
    };
    const second = {
      ...first,
      commit: "bbb2222",
      output: "done"
    };
    const content = `${JSON.stringify(first)}${JSON.stringify(second)}\n`;
    const journal = new ExperimentJournal("/repo/run.journal.jsonl", {
      async readFile() { return content; },
      async mkdir() {},
      async writeFile() {},
      async appendFile() {},
      async readdir() { return []; },
      async stat() { throw new Error("unused"); }
    });

    const entries = await journal.readAll();
    console.log(JSON.stringify({ content, entries }));
    expect(entries).toEqual([]);
  });
});
PROBE
npm exec -- vitest run packages/experiment-loop/src/__probe__.test.ts --reporter verbose
rm packages/experiment-loop/src/__probe__.test.ts
```

Output:

```text
{"content":"{\"commit\":\"aaa1111\",\"status\":\"keep\",\"scores\":{\"tests\":1},\"output\":\"printed { while debugging\",\"agentOutput\":\"\",\"durationMs\":1,\"timestamp\":\"2026-05-25T00:00:00.000Z\"}{\"commit\":\"bbb2222\",\"status\":\"keep\",\"scores\":{\"tests\":1},\"output\":\"done\",\"agentOutput\":\"\",\"durationMs\":1,\"timestamp\":\"2026-05-25T00:00:00.000Z\"}\n","entries":[]}
✓ packages/experiment-loop/src/__probe__.test.ts > concatenated journal entries containing brace text > fails to recover valid entries when an output string contains an unmatched brace
```

## Observed Behavior

`ExperimentJournal.readAll()` in `packages/experiment-loop/src/journal/journal.ts:31` through `packages/experiment-loop/src/journal/journal.ts:48` falls back to `parseLine()` when a line cannot be parsed as one JSON value. The recovery loop in `packages/experiment-loop/src/journal/journal.ts:93` through `packages/experiment-loop/src/journal/journal.ts:115` increments depth for every `{` and decrements it for every `}`, including braces occurring inside quoted string values. In the reproduction, the first entry's legitimate output message contains `{`; depth never returns to zero at either actual object boundary, so both otherwise valid concatenated entries disappear and `readAll()` resolves to an empty array.

## Expected Behavior

Recovery of concatenated JSON journal entries should parse valid JSON object boundaries while honoring quoted strings and escape sequences. User or agent output containing braces should not affect whether existing history entries can be read.

## Impact

Experiment history can silently appear empty after a concatenation condition if ordinary logged output includes braces, which is common for source snippets, JSON, template text, or diagnostics. Resumed runs can lose prior keep/discard state and baselines, prompts omit previous outcomes, and users reviewing the journal receive incomplete history without an error indicating data was dropped.
