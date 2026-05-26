# Agent human-in-loop osascript rejects CRLF approval output

## Summary

The exported `@poe-code/agent-human-in-loop` `osascriptProvider()` accepts a configurable executable path, but its output parser strips only trailing line-feed characters. A provider-compatible executable that emits the normal approval token using Windows-style `\r\n` line endings is rejected as an `osascript failed` error instead of returning an approved result.

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

describe("osascript provider CRLF output", () => {
  it("accepts an approval response terminated with CRLF", async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: "Approve\r\n", stderr: "" });
    const provider = osascriptProvider({ binary: "/fake/osascript" });

    await expect(provider.requestApproval({ message: "continue?" })).resolves.toEqual({
      outcome: "approved"
    });
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/agent-human-in-loop/src/__probe__.test.ts --reporter verbose
rm -f packages/agent-human-in-loop/src/__probe__.test.ts
```

The provider rejects the valid approval response:

```text
FAIL  packages/agent-human-in-loop/src/__probe__.test.ts > osascript provider CRLF output > accepts an approval response terminated with CRLF
AssertionError: promise rejected "Error: osascript failed: Error: unexpecte…" instead of resolving
Caused by: Error: osascript failed: Error: unexpected osascript output: Approve
```

## Observed Behavior

`parseStdout()` in `packages/agent-human-in-loop/src/providers/osascript-script.ts` normalizes output with `out.replace(/\n+$/u, "")`. For `"Approve\r\n"`, that removes only `\n` and leaves `"Approve\r"`, which does not match the accepted `"Approve"` token. `osascriptProvider()` in `packages/agent-human-in-loop/src/providers/osascript.ts` then catches that parser exception and rethrows it as an execution failure even though the child process returned a valid approval token plus a conventional line ending.

## Expected Behavior

The provider should accept valid response tokens terminated by ordinary newline conventions, including `\r\n`, particularly because callers may substitute a provider-compatible executable through the public `binary` option.

## Impact

Approval integrations implemented as wrappers, compatibility shims, or cross-platform test executables can successfully return an approval decision yet cause the host workflow to fail. This can block authorized actions and misreport a parsing incompatibility as a failed approval command.
