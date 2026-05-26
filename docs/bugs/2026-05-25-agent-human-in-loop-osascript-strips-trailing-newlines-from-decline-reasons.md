# Agent human-in-loop osascript strips trailing newlines from decline reasons

## Summary

The exported `@poe-code/agent-human-in-loop` `osascriptProvider()` returns optional free-form decline reasons, but its stdout parser strips every trailing newline from the complete output before separating the `DECLINED:` prefix from the user-provided reason. If the human's reason itself ends with a newline, that meaningful input is silently discarded.

## Reproduction

Create a disposable Vitest probe at `packages/agent-human-in-loop/src/__probe__.test.ts`:

```ts
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

const execFileAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [promisify.custom]: execFileAsyncMock
  })
}));

import { osascriptProvider } from "./providers/osascript.js";

describe("osascript decline reason whitespace", () => {
  it("preserves a trailing newline entered in a decline reason", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "DECLINED:line one\n\n", stderr: "" });
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    const result = await provider.requestApproval({
      message: "continue?",
      declineInputPrompt: "why not?"
    });
    console.log(JSON.stringify(result));
    expect(result).toEqual({ outcome: "declined", reason: "line one\n" });
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-human-in-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-human-in-loop/src/__probe__.test.ts
```

The returned reason has lost its user-entered trailing newline:

```text
{"outcome":"declined","reason":"line one"}
AssertionError: expected { outcome: 'declined', …(1) } to deeply equal { outcome: 'declined', …(1) }
-   "reason": "line one\n",
+   "reason": "line one",
```

## Observed Behavior

`buildScript()` in `packages/agent-human-in-loop/src/providers/osascript-script.ts` serializes a submitted decline reason as `"DECLINED:" & reason`; the child process adds its own output newline. `parseStdout()` then applies `out.replace(/\n+$/u, "")` to the entire stdout value before extracting the reason. Given `"DECLINED:line one\n\n"`, one newline is content from the submitted reason and one is process output framing, but both are removed and the API returns only `"line one"`.

## Expected Behavior

The provider should remove only transport framing from the command result while preserving the exact decline reason content supplied by the human, including any trailing newline characters in that reason.

## Impact

Callers that record approval rationale, forward it to agents, or audit human decisions receive altered user input without notice. Multiline decline explanations can lose significant formatting or content at their boundary, weakening traceability and making the provider unsuitable for faithful reason capture.
