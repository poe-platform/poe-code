---
name: "Agent eval terminal only legacy read drops external path from cheat report"
---

# Agent eval terminal only legacy read drops external path from cheat report

## Summary

The exported `@poe-code/agent-eval` trace normalization and cheat filtering APIs discard the `path` field from an ID-less legacy terminal `tool_complete` event for a read operation. A completion-only event that explicitly reports reading `/private/secret.txt` outside the evaluated clone is normalized with no paths and then produces a non-cheating report instead of an outside-clone violation.

## Reproduction

Create a disposable Vitest probe at `packages/agent-eval/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CheatFilter } from "./run/cheat.js";
import { normalizeTrace } from "./run/trace/normalize.js";
import type { SpawnEvent } from "./types.js";

describe("agent-eval terminal-only legacy read evidence", () => {
  it("reports a terminal-only external read as a violation", () => {
    const trace = normalizeTrace([
      {
        event: "tool_complete",
        title: "Read external",
        kind: "read",
        path: "/private/secret.txt"
      } as SpawnEvent
    ]);
    const filter = new CheatFilter({ cloneDir: "/work/clone" });

    for (const event of trace.events) {
      if (event.type === "tool") {
        filter.onEvent(event);
      }
    }

    const report = filter.report();
    console.log(JSON.stringify({ events: trace.events, report }));
    expect(report.violations).toEqual([
      { path: "/private/secret.txt", toolCall: "Read external", reason: "outside-clone" }
    ]);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-eval/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-eval/src/__probe__.test.ts
```

The probe logs the discarded path and fails:

```text
{"events":[{"type":"tool","sequence":0,"phase":"complete","name":"Read external","operation":"read","paths":[],"inspection":{"status":"uninspectable","reason":"missing-path"},"outcome":"completed"}],"report":{"cheated":false,"violations":[]}}
AssertionError: expected [] to deeply equal [ { path: "/private/secret.txt", toolCall: "Read external", reason: "outside-clone" } ]
```

## Observed Behavior

`packages/agent-eval/src/index.ts` publicly exports `normalizeTrace()` and `CheatFilter`. In `packages/agent-eval/src/run/trace/normalize.ts`, terminal legacy `event: "tool_complete"` reads call `readPaths()` without enabling `trustTerminalPath`; that function reads `event.path` only for start events or terminal edit/write operations. The explicit read path is therefore dropped, the normalized event is marked `missing-path`, and `packages/agent-eval/src/run/cheat.ts` receives no path to classify as outside the clone.

## Expected Behavior

When a terminal tool event explicitly provides the target of a completed read or search, trace normalization should preserve that evidence and the cheat filter should evaluate it against the clone boundary. A documented external access must not be converted into missing evidence and reported as non-cheating.

## Impact

Evaluations whose agent transport emits completion-only legacy read events can fail to detect direct reads outside the isolated clone, even when the event payload names the external file. This allows integrity violations to be omitted from run results and can incorrectly award a clean evaluation verdict to a run that accessed protected data.
