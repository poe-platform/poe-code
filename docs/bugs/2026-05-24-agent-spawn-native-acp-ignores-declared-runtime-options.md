# Agent spawn native ACP ignores declared runtime options

## Summary

The public `SpawnAcpOptions` interface declares runtime-routing controls including `runtime`, `runtimeImage`, `runtimeTemplate`, `detach`, `mountPoeCode`, and `runnerSync`. `spawnAcp()` never reads any of those values and always constructs a local `AcpClient` command process instead. Direct callers can request Docker, E2B, detachment, or workspace synchronization and silently receive a host ACP launch.

## Reproduction

From the repository root, run a disposable Vitest probe that calls `spawnAcp()` with Docker-specific options and captures the `AcpClient` constructor input:

```sh
cat > /tmp/acp-native-runtime-probe.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
const captures = vi.hoisted(() => ({ options: undefined as any }));
vi.mock("@poe-code/agent-defs", () => ({
  allAgents: [{ id: "opencode", binaryName: "opencode" }],
  resolveAgentId: () => "opencode"
}));
vi.mock("../configs/index.js", () => ({
  getAcpSpawnConfig: () => ({ kind: "acp", agentId: "opencode", acpArgs: ["serve"], skipAuth: true })
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
    async newSession() { return { sessionId: "ses_probe" }; }
    prompt() { return { response: Promise.resolve({ stopReason: "completed" }), async *[Symbol.asyncIterator]() {} }; }
    async dispose() {}
    constructor(options: unknown) { captures.options = options; }
  }
}));
import { spawnAcp } from "./spawn-acp.js";
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
describe("native ACP runtime probe", () => {
  it("constructs a local client despite requested Docker options", async () => {
    const handle = spawnAcp({
      agentId: "opencode",
      prompt: "hello",
      runtime: "docker",
      runtimeImage: "private/image",
      detach: true,
      mountPoeCode: true,
      runnerSync: "both"
    });
    await Promise.all([collect(handle.events), handle.done]);
    console.log(JSON.stringify(captures.options));
    expect(captures.options).toMatchObject({ command: "opencode", args: ["serve"] });
    expect(JSON.stringify(captures.options)).not.toContain("docker");
  });
});
EOF
cp /tmp/acp-native-runtime-probe.test.ts packages/agent-spawn/src/acp/__probe__.test.ts
trap 'rm -f packages/agent-spawn/src/acp/__probe__.test.ts' EXIT
cat > /tmp/vitest-acp-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/agent-spawn/src/acp/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-acp-probe.config.mjs --reporter verbose
nl -ba packages/agent-spawn/src/acp/spawn-acp.ts | sed -n '13,33p;86,135p'
```

## Observed Behavior

The probe passes and shows that `spawnAcp()` creates a host command client with no trace of the requested runtime selection or synchronization controls:

```text
{"command":"opencode","args":["serve"],"cwd":"/Users/kjopek/Workspace/poe-code","skipAuth":true,"autoApprove":true}
✓ packages/agent-spawn/src/acp/__probe__.test.ts > native ACP probes > constructs a local ACP client despite requested docker runtime options
```

The options are publicly declared in `packages/agent-spawn/src/acp/spawn-acp.ts:13` through `packages/agent-spawn/src/acp/spawn-acp.ts:33`, but implementation proceeds directly from configuration resolution into `new AcpClient(...)` in `packages/agent-spawn/src/acp/spawn-acp.ts:86` through `packages/agent-spawn/src/acp/spawn-acp.ts:135` and does not branch through any runtime execution environment.

## Expected Behavior

Either `spawnAcp()` should honor its declared runtime, detachment, mount, and workspace synchronization options, or those unsupported options should be removed/rejected so direct API callers cannot request execution isolation that is silently ignored.

## Impact

Applications invoking native ACP agents directly can unintentionally run commands and expose local files on the host when they requested container or remote isolation. They can also assume a detached or synchronized job exists when the API actually launches an unmanaged local ACP child process.
