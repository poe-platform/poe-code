# Agent human-in-loop osascript treats unrelated -128 errors as user declines

## Summary

The `osascript` approval provider identifies user cancellation by searching an entire error message and stderr for the substring `(-128)`. Any unrelated AppleScript or helper failure whose diagnostics mention that numeric text is therefore converted into `{ outcome: "declined" }` instead of surfacing an execution error.

## Reproduction

From the repository root, run a disposable Vitest probe using the provider test suite's established `promisify.custom` mock pattern to reject `osascript` with an ordinary helper failure whose stderr happens to contain `(-128)`:

```sh
cat > /tmp/agent-human-in-loop-osascript-minus128-probe.test.ts <<'PROBE'
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [promisify.custom]: execFileAsyncMock,
  }),
}));

import { osascriptProvider } from "./providers/osascript.js";

describe("osascript unrelated -128 error", () => {
  beforeEach(() => execFileAsyncMock.mockReset());

  it("reports an ordinary helper failure containing -128 as a user decline", async () => {
    execFileAsyncMock.mockRejectedValueOnce(Object.assign(new Error("execution failed"), {
      stderr: "bad argument (-128) was passed to helper",
    }));
    const response = await osascriptProvider({ binary: "/fake/osascript" }).requestApproval({ message: "approve?" });
    console.log(JSON.stringify(response));
    expect(response).toEqual({ outcome: "declined" });
  });
});
PROBE
cp /tmp/agent-human-in-loop-osascript-minus128-probe.test.ts packages/agent-human-in-loop/src/__probe__.test.ts
trap 'rm -f packages/agent-human-in-loop/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-human-in-loop/src/__probe__.test.ts --reporter verbose
```

## Observed Behavior

The provider reports that the human declined even though the simulated error describes an unrelated helper failure:

```text
{"outcome":"declined"}
✓ packages/agent-human-in-loop/src/__probe__.test.ts > osascript unrelated -128 error > reports an ordinary helper failure containing -128 as a user decline
```

`packages/agent-human-in-loop/src/providers/osascript.ts:14` through `packages/agent-human-in-loop/src/providers/osascript.ts:18` implement cancellation detection as a plain substring search for `(-128)` across all error text. `packages/agent-human-in-loop/src/providers/osascript.ts:32` through `packages/agent-human-in-loop/src/providers/osascript.ts:41` then return a declined approval result whenever that search matches, suppressing the underlying execution failure.

## Expected Behavior

The provider should classify a request as declined only when `osascript` reports the specific user-cancelled failure form, not whenever arbitrary diagnostics contain the characters `(-128)`. Unrelated script failures should reject with an actionable `osascript failed` error.

## Impact

Automation and approval workflows can silently treat operational failures, malformed scripts, or helper errors as an explicit human rejection. This hides infrastructure problems, produces false audit trails, and may cause callers to abandon or alter work under the incorrect belief that a user denied approval.
