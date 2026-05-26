# Agent spawn native ACP abort during session start still prompts and reports success

## Summary

`spawnAcp()` responds to an abort signal by setting an `aborted` flag and disposing the ACP client, but if abort occurs while `newSession()` is pending, no session ID exists to cancel. Once session creation later resolves, the implementation still emits `session_start`, invokes `client.prompt(...)`, and may resolve with exit code `0` rather than rejecting with `AbortError`.

## Reproduction

From the repository root, run a disposable Vitest probe whose mocked `newSession()` stays pending until after cancellation:

```sh
cat > /tmp/acp-native-abort-session-start-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
const captures = vi.hoisted(() => ({ client: undefined as any, resolveSession: undefined as any }));
vi.mock("@poe-code/agent-defs", () => ({
  allAgents: [{ id: "opencode", binaryName: "opencode" }],
  resolveAgentId: () => "opencode"
}));
vi.mock("../configs/index.js", () => ({
  getAcpSpawnConfig: () => ({ kind: "acp", agentId: "opencode", acpArgs: [], skipAuth: true })
}));
vi.mock("../skill-bridge.js", () => ({
  bridgeResourcesForRun: () => ({ runId: "probe" }),
  cleanupResourcesForRun: vi.fn()
}));
vi.mock("../observability/otel.js", () => ({
  observeAgentSpawn: (_options: unknown, run: () => unknown) => run()
}));
vi.mock("@poe-code/poe-acp-client", () => ({
  AcpClient: class {
    state = "ready";
    async initialize() { return { protocolVersion: 1 }; }
    newSession = vi.fn(() => new Promise((resolve) => { captures.resolveSession = resolve; }));
    prompt = vi.fn(() => ({ response: Promise.resolve({ stopReason: "completed" }), async *[Symbol.asyncIterator]() {} }));
    cancelSession = vi.fn(async () => {});
    dispose = vi.fn(async () => {});
    constructor() { captures.client = this; }
  }
}));
import { spawnAcp } from "./spawn-acp.js";
describe("native ACP abort probe", () => {
  it("prompts after cancellation while session creation is pending", async () => {
    const controller = new AbortController();
    const handle = spawnAcp({ agentId: "opencode", prompt: "secret action", signal: controller.signal });
    await vi.waitFor(() => expect(captures.client.newSession).toHaveBeenCalledTimes(1));
    controller.abort();
    captures.resolveSession({ sessionId: "ses_after_abort" });
    const result = await handle.done;
    console.log(JSON.stringify({ result, promptCalls: captures.client.prompt.mock.calls, cancelCalls: captures.client.cancelSession.mock.calls }));
    expect(result.exitCode).toBe(0);
    expect(captures.client.prompt).toHaveBeenCalledWith("ses_after_abort", [{ type: "text", text: "secret action" }]);
    expect(captures.client.cancelSession).not.toHaveBeenCalled();
  });
});
EOF
cp /tmp/acp-native-abort-session-start-probe.test.ts packages/agent-spawn/src/acp/__probe__.test.ts
trap 'rm -f packages/agent-spawn/src/acp/__probe__.test.ts' EXIT
cat > /tmp/vitest-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/agent-spawn/src/acp/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-acp-probe.config.mjs --reporter verbose
nl -ba packages/agent-spawn/src/acp/spawn-acp.ts | sed -n '137,147p;220,324p'
```

## Observed Behavior

The combined investigation first expected an abort rejection, but the assertion failed because the promise resolved successfully after running the prompt:

```text
AssertionError: promise resolved "{ stdout: '', stderr: '', …(2) }" instead of rejecting
+ {
+   "exitCode": 0,
+   "stderr": "",
+   "stdout": "",
+   "threadId": "ses_after_abort",
+ }
```

With the expectation adjusted to show the behavior explicitly, `client.prompt("ses_after_abort", [{ type: "text", text: "secret action" }])` is called after `controller.abort()`, and `cancelSession` has no call because abort happened before `sessionId` was assigned. The abort callback checks only the already-known `sessionId` in `packages/agent-spawn/src/acp/spawn-acp.ts:137` through `packages/agent-spawn/src/acp/spawn-acp.ts:147`, while the run path unconditionally continues from awaited session creation into `pushEvent(...)` and `client.prompt(...)` in `packages/agent-spawn/src/acp/spawn-acp.ts:238` through `packages/agent-spawn/src/acp/spawn-acp.ts:277`.

## Expected Behavior

Once the supplied signal aborts, `spawnAcp()` should stop progressing the turn, reject with `AbortError`, and cancel or dispose any session that resolves after cancellation without submitting the caller's prompt.

## Impact

Cancellation during ACP session startup is not reliable: commands or sensitive prompts can be sent after a user has cancelled, while orchestration receives an apparently successful result. This can trigger unintended agent work and misreport cancelled operations as completed.
